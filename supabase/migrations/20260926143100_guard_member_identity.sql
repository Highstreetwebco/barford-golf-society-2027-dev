create or replace function baseline_private.protect_username() returns trigger language plpgsql security definer set search_path='' as $$
declare n text;
begin
 select m.name into n from public.baseline_member_accounts a join public.baseline_members m on m.id=a.member_id where a.user_id=new.id;
 if n is not null then
  new.full_name:=n;
  if new.phone is distinct from old.phone and (new.phone is null or new.phone !~ '^\+?[0-9 ()-]{10,25}$' or length(regexp_replace(new.phone,'[^0-9]','','g')) not between 10 and 15) then raise exception 'Enter a valid mobile number'; end if;
 end if;
 return new;
end $$;
drop trigger baseline_protect_username on public.profiles;
create trigger baseline_protect_username before update of full_name,phone on public.profiles for each row execute function baseline_private.protect_username();

create or replace function baseline_private.submit_rsvp(payload jsonb)
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
 if exists(select 1 from public.baseline_member_accounts where user_id=member and disabled) then raise exception 'Contact an organiser about your account'; end if;
 if not exists(select 1 from public.baseline_member_accounts where user_id=member and member_id is not null and not disabled) then raise exception 'Link your scoreboard name in My account before RSVPing'; end if;
 select * into person from public.profiles where id=member;
 if person.id is null or length(trim(person.full_name)) not between 1 and 150 then raise exception 'Add your name in My account first'; end if;
 if jsonb_typeof(payload->'attending') is distinct from 'boolean' then raise exception 'Choose whether you are playing'; end if;
 wants:=(payload->>'attending')::boolean;
 needs_buggy:=wants and coalesce((payload->>'buggy')::boolean,false);
 pref:=case when wants then payload->>'preferred_time' else null end;
 if pref is not null and pref not in ('First','Middle','End') then raise exception 'Choose First, Middle or End'; end if;
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

