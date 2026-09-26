-- Applies only to the isolated 2027 baseline. Existing accounts and legacy tables are retained.
-- Stop if anonymous baseline submissions have appeared; never silently discard or misattribute them.
do $$ begin
 if exists(select 1 from public.baseline_rsvps) or exists(select 1 from public.baseline_trip_votes) then
  raise exception 'Existing baseline responses require explicit account matching before this migration';
 end if;
end $$;

alter table public.baseline_events add column tee_times_dirty boolean not null default false;
alter table public.baseline_rsvps add column user_id uuid not null references public.profiles(id) on delete cascade;
alter table public.baseline_rsvps add column updated_at timestamptz not null default now();
alter table public.baseline_rsvps add column requested_at timestamptz not null default now();
drop index public.baseline_rsvp_unique_name;
alter table public.baseline_rsvps add constraint baseline_rsvp_one_per_member unique(event_id,user_id);
alter table public.baseline_rsvps add constraint baseline_rsvp_valid_preference check(preferred_time is null or preferred_time in ('First','Middle','End'));
create index baseline_rsvps_user_idx on public.baseline_rsvps(user_id);
alter table public.baseline_trip_votes add column user_id uuid not null references public.profiles(id) on delete cascade;
drop index public.baseline_vote_unique_name;
alter table public.baseline_trip_votes add constraint baseline_vote_one_per_member unique(event_id,user_id);
create index baseline_trip_votes_user_idx on public.baseline_trip_votes(user_id);

drop policy "Public 2027 submissions" on public.baseline_rsvps;
drop policy "Public 2027 content" on public.baseline_rsvps;
drop policy "2027 administrator" on public.baseline_rsvps;
drop policy "Public 2027 submissions" on public.baseline_rsvp_contacts;
drop policy "Public 2027 submissions" on public.baseline_trip_votes;
drop policy "Public 2027 content" on public.baseline_trip_votes;
revoke all on public.baseline_rsvps,public.baseline_trip_votes,public.baseline_rsvp_contacts from anon;
revoke insert,update,delete on public.baseline_rsvps from authenticated;
create policy "Members read event responses" on public.baseline_rsvps for select to authenticated using(true);
create policy "Members read trip responses" on public.baseline_trip_votes for select to authenticated using(true);

-- Privileged implementations are outside the API schema. Identity always comes from auth.uid().
create function baseline_private.submit_rsvp(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 caller uuid:=auth.uid(); member uuid; ev public.baseline_events; old public.baseline_rsvps;
 saved public.baseline_rsvps; person public.profiles; wants boolean; needs_buggy boolean;
 pref text; occupied integer; candidate record; force_wait boolean;
begin
 if caller is null then raise exception 'Sign in to save your RSVP'; end if;
 member:=coalesce((payload->>'user_id')::uuid,caller);
 if member<>caller and not public.is_admin() then raise exception 'You can only update your own RSVP'; end if;
 if payload ? 'reserve' and not public.is_admin() then raise exception 'Only an organiser can change waiting list priority'; end if;
 select * into ev from public.baseline_events where id=(payload->>'event_id')::bigint for update;
 if ev.id is null or ev.cancelled then raise exception 'This event is unavailable'; end if;
 if ev.date < current_date and not public.is_admin() then raise exception 'RSVPs are closed for this event'; end if;
 select * into person from public.profiles where id=member;
 if person.id is null or length(trim(person.full_name)) not between 1 and 150 then raise exception 'Add your name in My account first'; end if;
 if jsonb_typeof(payload->'attending') is distinct from 'boolean' then raise exception 'Choose whether you are playing'; end if;
 wants:=(payload->>'attending')::boolean;
 needs_buggy:=wants and coalesce((payload->>'buggy')::boolean,false);
 pref:=case when wants then payload->>'preferred_time' else null end;
 if wants and (pref is null or pref not in ('First','Middle','End')) then raise exception 'Choose First, Middle or End'; end if;
 force_wait:=coalesce((payload->>'reserve')::boolean,false) and wants;
 select * into old from public.baseline_rsvps where event_id=ev.id and user_id=member;
 insert into public.baseline_rsvps(event_id,user_id,name,attending,reserve,buggy,preferred_time,flexibility,requested_at)
 values(ev.id,member,trim(person.full_name),wants and coalesce(old.attending,false) and not force_wait,
        wants and (not coalesce(old.attending,false) or force_wait),needs_buggy,pref,null,
        case when old.attending or old.reserve then old.requested_at else now() end)
 on conflict(event_id,user_id) do update set name=excluded.name,attending=excluded.attending,reserve=excluded.reserve,
 buggy=excluded.buggy,preferred_time=excluded.preferred_time,flexibility=null,requested_at=excluded.requested_at,updated_at=now()
 returning * into saved;
 -- Keep a valid saved contact private. It is never included in the public tee sheet.
 if length(trim(coalesce(person.phone,''))) between 5 and 40 then
  insert into public.baseline_rsvp_contacts(rsvp_id,phone) values(saved.id,trim(person.phone))
  on conflict(rsvp_id) do update set phone=excluded.phone;
 else
  delete from public.baseline_rsvp_contacts where rsvp_id=saved.id;
 end if;
 select count(*) into occupied from public.baseline_rsvps where event_id=ev.id and attending and not reserve;
 for candidate in select id from public.baseline_rsvps where event_id=ev.id and reserve
  and (not force_wait or id<>saved.id) order by requested_at,id loop
  exit when ev.max_players is not null and occupied>=ev.max_players;
  update public.baseline_rsvps set attending=true,reserve=false,updated_at=now() where id=candidate.id;
  occupied:=occupied+1;
 end loop;
 select * into saved from public.baseline_rsvps where id=saved.id;
 if exists(select 1 from public.baseline_tee_times where event_id=ev.id) and
  (coalesce(old.attending,false) is distinct from saved.attending or
   (saved.attending and old.buggy is distinct from saved.buggy)) then
  update public.baseline_events set tee_times_dirty=true where id=ev.id;
 end if;
 return jsonb_build_object('id',saved.id,'attending',saved.attending,'reserve',saved.reserve,
  'buggy',saved.buggy,'preferred_time',saved.preferred_time);
end $$;
revoke all on function baseline_private.submit_rsvp(jsonb) from public,anon;
grant execute on function baseline_private.submit_rsvp(jsonb) to authenticated;
create or replace function public.baseline_submit_rsvp(payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select baseline_private.submit_rsvp(payload); $$;
revoke all on function public.baseline_submit_rsvp(jsonb) from public,anon;
grant execute on function public.baseline_submit_rsvp(jsonb) to authenticated;

create function baseline_private.event_counts()
returns table(event_id bigint,playing bigint,waiting bigint) language sql stable security definer set search_path='' as $$
 select event_id,count(*) filter(where attending and not reserve),count(*) filter(where reserve)
 from public.baseline_rsvps group by event_id;
$$;
revoke all on function baseline_private.event_counts() from public;
grant usage on schema baseline_private to anon;
grant execute on function baseline_private.event_counts() to anon,authenticated;
create function public.baseline_event_counts()
returns table(event_id bigint,playing bigint,waiting bigint) language sql stable security invoker set search_path='' as $$
 select * from baseline_private.event_counts();
$$;
revoke all on function public.baseline_event_counts() from public;
grant execute on function public.baseline_event_counts() to anon,authenticated;

create function baseline_private.vote(event bigint,choice text)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); member_name text;
begin
 if uid is null then raise exception 'Sign in to register your interest'; end if;
 if choice is null or choice not in ('yes','no') then raise exception 'Choose Yes or No'; end if;
 select full_name into member_name from public.profiles where id=uid;
 if member_name is null then raise exception 'Complete your account first'; end if;
 insert into public.baseline_trip_votes(event_id,user_id,name,vote) values(event,uid,member_name,choice)
 on conflict(event_id,user_id) do update set vote=excluded.vote,name=excluded.name;
end $$;
revoke all on function baseline_private.vote(bigint,text) from public,anon;
grant execute on function baseline_private.vote(bigint,text) to authenticated;
create function public.baseline_vote(event bigint,choice text) returns void language sql security invoker set search_path='' as $$ select baseline_private.vote(event,choice); $$;
revoke all on function public.baseline_vote(bigint,text) from public,anon;
grant execute on function public.baseline_vote(bigint,text) to authenticated;

create function baseline_private.save_tee_times(event bigint,groups jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare g jsonb; player jsonb; roster jsonb; r public.baseline_rsvps; seen uuid[]:='{}'; n integer:=0; uid uuid;
begin
 if not public.is_admin() then raise exception 'Organiser access required'; end if;
 perform 1 from public.baseline_events where id=event for update;
 if not found then raise exception 'Event not found'; end if;
 if jsonb_typeof(groups) is distinct from 'array' then raise exception 'Invalid tee groups'; end if;
 delete from public.baseline_tee_times where event_id=event;
 for g in select value from jsonb_array_elements(groups) loop
  if g->>'time' is null or g->>'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Enter a valid tee time'; end if;
  if jsonb_typeof(g->'players') is distinct from 'array' or jsonb_array_length(g->'players') not between 1 and 4 then raise exception 'Each group needs one to four players'; end if;
  roster:='[]'::jsonb;
  for player in select value from jsonb_array_elements(g->'players') loop
   uid:=(player#>>'{}')::uuid;
   if uid=any(seen) then raise exception 'A player appears more than once'; end if;
   select * into r from public.baseline_rsvps where event_id=event and user_id=uid and attending and not reserve;
   if r.id is null then raise exception 'A player is no longer confirmed. Reload RSVPs'; end if;
   seen:=array_append(seen,uid);
   roster:=roster||jsonb_build_array(jsonb_build_object('user_id',uid,'name',r.name,'type',case when r.buggy then 'buggy' else 'walker' end));
  end loop;
  n:=n+1;
  insert into public.baseline_tee_times(event_id,group_number,tee_time,players) values(event,n,g->>'time',roster);
 end loop;
 if cardinality(seen)<>(select count(*) from public.baseline_rsvps where event_id=event and attending and not reserve) then
  raise exception 'Include every confirmed player before publishing';
 end if;
 update public.baseline_events set tee_times_dirty=false where id=event;
end $$;
revoke all on function baseline_private.save_tee_times(bigint,jsonb) from public,anon;
grant execute on function baseline_private.save_tee_times(bigint,jsonb) to authenticated;
create function public.baseline_save_tee_times(event bigint,groups jsonb) returns void language sql security invoker set search_path='' as $$ select baseline_private.save_tee_times(event,groups); $$;
revoke all on function public.baseline_save_tee_times(bigint,jsonb) from public,anon;
grant execute on function public.baseline_save_tee_times(bigint,jsonb) to authenticated;

-- Order cancellation and stock restoration are one transaction, protected against double clicks.
create function baseline_private.cancel_order(order_id bigint)
returns void language plpgsql security definer set search_path='' as $$
declare o public.baseline_shop_orders;
begin
 if not public.is_admin() then raise exception 'Organiser access required'; end if;
 select * into o from public.baseline_shop_orders where id=order_id for update;
 if o.id is null then raise exception 'This order has already been cancelled'; end if;
 if not o.delivered then update public.baseline_products set packs_left=packs_left+o.quantity where id=o.product_id; end if;
 delete from public.baseline_shop_orders where id=o.id;
end $$;
revoke all on function baseline_private.cancel_order(bigint) from public,anon;
grant execute on function baseline_private.cancel_order(bigint) to authenticated;
create function public.baseline_cancel_order(order_id bigint) returns void language sql security invoker set search_path='' as $$ select baseline_private.cancel_order(order_id); $$;
revoke all on function public.baseline_cancel_order(bigint) from public,anon;
grant execute on function public.baseline_cancel_order(bigint) to authenticated;

-- Player names and tee groups are member content; anonymous visitors see counts only.
drop policy "Public 2027 content" on public.baseline_tee_times;
revoke select on public.baseline_tee_times from anon;
create policy "Members read tee times" on public.baseline_tee_times for select to authenticated using(true);
