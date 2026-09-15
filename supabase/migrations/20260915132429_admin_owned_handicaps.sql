begin;
-- Committee-owned handicaps. Existing values and played-round snapshots are preserved.
create or replace function public.protect_member_handicap()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE' then
    if new.handicap is not distinct from old.handicap then return new; end if;
  elsif new.handicap is null then
    return new;
  end if;
  if current_user not in ('postgres','supabase_admin','service_role') and not public.is_admin() then
    raise exception 'Only the committee can set or change a society handicap.' using errcode='42501';
  end if;
  if new.handicap is not null and (new.handicap::text in ('NaN','Infinity','-Infinity')
     or new.handicap < 0 or new.handicap > 54 or round(new.handicap,1) <> new.handicap) then
    raise exception 'Enter a handicap from 0 to 54, with up to one decimal place.' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_member_handicap() from public,anon,authenticated;
drop trigger if exists protect_member_handicap on public.profiles;
create trigger protect_member_handicap before insert or update of handicap on public.profiles
for each row execute function public.protect_member_handicap();

-- Cached clients receive a clear error rather than retaining a self-service route.
create or replace function public.set_initial_handicap(initial_handicap numeric)
returns numeric language plpgsql security invoker set search_path = ''
as $$ begin raise exception 'The committee will set your society handicap. Please contact an administrator.' using errcode='42501'; end; $$;
revoke all on function public.set_initial_handicap(numeric) from public,anon;
grant execute on function public.set_initial_handicap(numeric) to authenticated;

-- Invoker privileges retain profile RLS. Admin authorization is checked on every save.
create or replace function public.admin_set_member_handicap(target_member_id uuid, new_handicap numeric, expected_handicap numeric)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare saved public.profiles%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access required.' using errcode='42501';
  end if;
  if new_handicap is null or new_handicap::text in ('NaN','Infinity','-Infinity')
     or new_handicap < 0 or new_handicap > 54 or round(new_handicap,1) <> new_handicap then
    raise exception 'Enter a handicap from 0 to 54, with up to one decimal place.' using errcode='22023';
  end if;
  update public.profiles set handicap=new_handicap,updated_at=now()
  where id=target_member_id and handicap is not distinct from expected_handicap
  returning * into saved;
  if not found then raise exception 'This member was updated or removed. Refresh the list before saving.' using errcode='40001'; end if;
  return jsonb_build_object('id',saved.id,'handicap',saved.handicap);
end;
$$;
revoke all on function public.admin_set_member_handicap(uuid,numeric,numeric) from public,anon;
grant execute on function public.admin_set_member_handicap(uuid,numeric,numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.create_profile_for_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  requested_category text := new.raw_user_meta_data->>'playing_category';
  requested_primary text := coalesce(nullif(new.raw_user_meta_data->>'theme_primary',''), '#315C4A');
  requested_accent text := coalesce(nullif(new.raw_user_meta_data->>'theme_accent',''), '#C7A96B');
begin
  if requested_category not in ('men','women') then
    raise exception 'A playing category is required to create a Barford Golf Society account';
  end if;
  if requested_primary !~ '^#[0-9A-Fa-f]{6}$' or requested_accent !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Dashboard colours must be six-digit hex colours';
  end if;

  insert into public.profiles (
    id, full_name, email, phone, playing_category, handicap,
    leaderboard_active, leaderboard_from_round, theme_primary, theme_accent
  )
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'Member'),
    coalesce(new.email, ''),
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    requested_category,
    null,
    true,
    public.next_eligible_round(),
    upper(requested_primary),
    upper(requested_accent)
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_member_notices()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller uuid := auth.uid();
  result jsonb := '[]'::jsonb;
  p public.profiles%rowtype;
  next_event public.events%rowtype;
  my_rsvp public.rsvps%rowtype;
  my_tee time;
begin
  if caller is null then return result; end if;
  select * into p from public.profiles where id=caller;
  if not found then return result; end if;

  if p.playing_category is null then
    result := result || jsonb_build_array(jsonb_build_object('type','profile','priority',2,'title','Choose your playing category','body','Add your playing category so event scoring uses the correct tees.','action_url','account.html'));
  end if;
  if p.handicap is null then
    result := result || jsonb_build_array(jsonb_build_object('type','profile','priority',2,'title','Handicap awaiting admin','body','The committee will set your society handicap. You can still browse events and RSVP.','action_url','account.html'));
  end if;

  select * into next_event from public.events
  where event_date >= current_date and status <> 'cancelled'
  order by event_date limit 1;

  if found then
    select * into my_rsvp from public.rsvps where event_id=next_event.id and member_id=caller order by created_at desc limit 1;
    if not found or my_rsvp.status not in ('playing','reserve') then
      result := result || jsonb_build_array(jsonb_build_object('type','rsvp','priority',2,'title','RSVP for '||next_event.name,'body','Tell the committee whether you are playing.','action_url','index.html'));
    elsif my_rsvp.status='playing' then
      select tee_time into my_tee from public.tee_times where event_id=next_event.id and member_id=caller order by tee_time limit 1;
      if found then
        result := result || jsonb_build_array(jsonb_build_object('type','tee','priority',1,'title','Your tee time is '||to_char(my_tee,'HH24:MI'),'body',next_event.name||' · '||to_char(next_event.event_date,'Dy DD Mon'),'action_url','index.html'));
      end if;
      if coalesce(my_rsvp.payment_status,'') <> 'paid' and coalesce(next_event.price,0) > 0 then
        result := result || jsonb_build_array(jsonb_build_object('type','payment','priority',1,'title','Event payment outstanding','body',next_event.name||' still needs paying.','action_url','payments.html'));
      end if;
    end if;
  end if;

  if exists(select 1 from public.events e join public.rsvps x on x.event_id=e.id where x.member_id=caller and x.status='playing' and e.status='cancelled' and e.event_date>=current_date) then
    result := jsonb_build_array(jsonb_build_object('type','cancelled','priority',3,'title','An event you joined has been cancelled','body','Open Events for the latest details.','action_url','events.html')) || result;
  end if;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_event_scorecards(target_event_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare created_count integer;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if exists (select 1 from public.event_scorecards where event_id=target_event_id and status <> 'ready') then raise exception 'Scoring has already started. Existing round handicaps cannot be replaced.'; end if;
  if exists (select 1 from public.tee_times t join public.profiles p on p.id=t.member_id where t.event_id=target_event_id and p.handicap is null) then raise exception 'Set missing member handicaps using Admin > Add handicaps before preparing scorecards.'; end if;
  if (select count(*) from public.event_holes where event_id = target_event_id and red_yards is not null) <> 18 then
    raise exception 'Load the yellow and red course scorecards first';
  end if;
  if not exists (select 1 from public.tee_times where event_id = target_event_id and member_id is not null) then
    raise exception 'Publish tee times before preparing scorecards';
  end if;
  if exists (
    select 1 from public.tee_times t join public.profiles p on p.id=t.member_id
    where t.event_id=target_event_id and t.member_id is not null and p.playing_category is null
  ) then raise exception 'Every player must select Men''s or Women''s playing category in My Account'; end if;

  insert into public.event_scorecards (event_id, tee_time, tee_number)
  select distinct event_id, tee_time, tee_number from public.tee_times
  where event_id = target_event_id and member_id is not null
  on conflict (event_id, tee_time, tee_number) do nothing;
  get diagnostics created_count = row_count;

  insert into public.event_scorecard_players (scorecard_id, member_id, display_name, handicap_used, position, playing_category, tee_name)
  select c.id, t.member_id, p.full_name,
    greatest(0, least(54, round(p.handicap)::integer)), t.position, p.playing_category,
    case when p.playing_category='women' then coalesce(h.red_tee_name,'Red') else coalesce(h.yellow_tee_name,'Yellow') end
  from public.tee_times t
  join public.event_scorecards c on c.event_id=t.event_id and c.tee_time=t.tee_time and c.tee_number=t.tee_number
  join public.profiles p on p.id=t.member_id
  left join public.event_holes h on h.event_id=t.event_id and h.hole_number=1
  where t.event_id=target_event_id and t.member_id is not null
  on conflict (scorecard_id, member_id) do update set
    display_name=excluded.display_name,handicap_used=excluded.handicap_used,position=excluded.position,
    playing_category=excluded.playing_category,tee_name=excluded.tee_name;
  return created_count;
end;
$function$;

commit;
