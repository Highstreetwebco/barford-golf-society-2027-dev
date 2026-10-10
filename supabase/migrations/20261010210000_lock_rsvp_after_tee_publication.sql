-- Existing member responses lock six calendar days before the event in UK time.
-- Organisers can still update the RSVP when a member contacts the committee.
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
 if ev.event_type <> 'social' and ev.tee_published_at is not null and not public.is_admin() then
  raise exception 'If you need to withdraw from the event please contact the committee';
 end if;
 if ev.id is null or ev.cancelled then raise exception 'This event is unavailable'; end if;
 if ev.date < (now() at time zone 'Europe/London')::date and not public.is_admin() then raise exception 'RSVPs are closed for this event'; end if;
 if exists(select 1 from public.baseline_member_accounts where user_id=member and disabled) then raise exception 'Contact an organiser about your account'; end if;
 select * into person from public.profiles where id=member;
 if person.id is null or length(trim(person.full_name)) not between 1 and 150 then raise exception 'Add your name in My account first'; end if;
 if jsonb_typeof(payload->'attending') is distinct from 'boolean' then raise exception 'Choose whether you are playing'; end if;
 wants:=(payload->>'attending')::boolean;
 select * into old from public.baseline_rsvps where event_id=ev.id and user_id=member for update;
 if old.id is not null and not public.is_admin() and (now() at time zone 'Europe/London')::date >= ev.date - 6 then
  raise exception 'Online RSVP changes close six days before the event. Contact the committee to change your RSVP';
 end if;
 if wants and not public.is_admin() and ev.rsvp_deadline is not null and (now() at time zone 'Europe/London')::date>ev.rsvp_deadline and not exists(select 1 from public.baseline_rsvps where event_id=ev.id and user_id=member and (attending or reserve)) then raise exception 'The RSVP deadline has passed. Contact an organiser'; end if;
 if wants and not public.is_admin() and length(coalesce(ev.cancellation_terms,''))>0 and payload->>'accept_terms' is distinct from 'true' and not exists(select 1 from public.baseline_rsvps where event_id=ev.id and user_id=member and (attending or reserve) and terms_snapshot=ev.cancellation_terms) then raise exception 'Accept the cancellation terms before booking'; end if;
 needs_buggy:=ev.event_type<>'social' and wants and coalesce((payload->>'buggy')::boolean,false);
 pref:=case when wants and ev.event_type<>'social' then payload->>'preferred_time' else null end;
 if pref is not null and pref not in ('First','Middle','End') then raise exception 'Choose First, Middle or End'; end if;
 force_wait:=coalesce((payload->>'reserve')::boolean,false) and wants;
 insert into public.baseline_rsvps(event_id,user_id,name,attending,reserve,buggy,preferred_time,flexibility,requested_at)
 values(ev.id,member,trim(person.full_name),wants and coalesce(old.attending,false) and not force_wait,
        wants and (not coalesce(old.attending,false) or force_wait),needs_buggy,pref,null,
        case when old.attending or old.reserve then old.requested_at else now() end)
 on conflict(event_id,user_id) do update set name=excluded.name,attending=excluded.attending,reserve=excluded.reserve,
 buggy=excluded.buggy,preferred_time=excluded.preferred_time,flexibility=null,requested_at=excluded.requested_at,updated_at=now()
 returning * into saved;
 update public.baseline_rsvps set flexibility=case when needs_buggy and payload->>'flexibility'='walk' then 'walk' else null end,
 terms_accepted_at=case when wants and payload->>'accept_terms'='true' then now() else terms_accepted_at end,
 terms_snapshot=case when wants and payload->>'accept_terms'='true' then ev.cancellation_terms else terms_snapshot end where id=saved.id;
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
