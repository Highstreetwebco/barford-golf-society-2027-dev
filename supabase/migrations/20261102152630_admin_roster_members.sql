-- Manage every roster member, including people who have not created a login.
-- Contact numbers stay outside the publicly readable name roster.
create table baseline_private.member_contacts (
 member_id uuid primary key references public.baseline_members(id) on delete cascade,
 phone text not null check(phone ~ '^\+?[0-9 ()-]{10,25}$' and length(regexp_replace(phone,'[^0-9]','','g')) between 10 and 15),
 updated_at timestamptz not null default now()
);
alter table baseline_private.member_contacts enable row level security;
revoke all on baseline_private.member_contacts from public,anon,authenticated;

create function baseline_private.admin_members()
returns table(id uuid,username text,mobile text,handicap numeric,is_admin boolean,disabled boolean,member_id uuid,created_at timestamptz,registered boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 return query select x.* from (
  select a.*,true as registered from baseline_private.admin_accounts() a
  union all
  select m.id,m.name,c.phone,m.starting_handicap,false,false,m.id,null::timestamptz,false
  from public.baseline_members m left join baseline_private.member_contacts c on c.member_id=m.id
  where not m.invite_only and not exists(select 1 from public.baseline_member_accounts a where a.member_id=m.id)
 ) x order by lower(x.username),x.id;
end $$;
create function public.baseline_admin_members()
returns table(id uuid,username text,mobile text,handicap numeric,is_admin boolean,disabled boolean,member_id uuid,created_at timestamptz,registered boolean)
language sql stable security invoker set search_path='' as $$select * from baseline_private.admin_members();$$;
revoke all on function baseline_private.admin_members(),public.baseline_admin_members() from public,anon;
grant execute on function baseline_private.admin_members(),public.baseline_admin_members() to authenticated;

create function baseline_private.admin_save_roster_member(target uuid,username text,mobile text,society_handicap numeric)
returns void language plpgsql security definer set search_path='' as $$
declare person public.baseline_members; contact text:=nullif(trim(mobile),''); ev record;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 -- Registration and offline bookings use this same lock before claiming the roster row.
 perform pg_advisory_xact_lock(2027,501);
 select * into person from public.baseline_members where id=target and not invite_only for update;
 if person.id is null then raise exception 'Member not found'; end if;
 if exists(select 1 from public.baseline_member_accounts where member_id=target) then
  raise exception 'This member now has a login. Refresh Members before editing';
 end if;
 if length(trim(coalesce(username,''))) not between 2 and 150 or username ~ '[[:cntrl:]]' then raise exception 'Enter a valid member name'; end if;
 if exists(select 1 from public.baseline_members where id<>target and lower(trim(name))=lower(trim(username))) then raise exception 'That username is already in use'; end if;
 if contact is not null and (contact !~ '^\+?[0-9 ()-]{10,25}$' or length(regexp_replace(contact,'[^0-9]','','g')) not between 10 and 15) then raise exception 'Enter a valid mobile number or leave it blank'; end if;
 if society_handicap is not null and (society_handicap::text in ('NaN','Infinity','-Infinity') or society_handicap<0 or society_handicap>36 or round(society_handicap,1)<>society_handicap) then raise exception 'Starting handicap must be 0 to 36, with at most one decimal place'; end if;
 if society_handicap is null and exists(select 1 from baseline_private.league_rounds r,jsonb_array_elements(r.published_entries) x where x->>'user_id'=target::text and x->>'points' is not null) then raise exception 'A player with published scores needs a starting handicap'; end if;
 -- Serialize name/contact propagation with RSVP and tee-sheet edits.
 for ev in select e.id from public.baseline_events e where exists(select 1 from public.baseline_rsvps r where r.event_id=e.id and r.member_id=target and r.user_id is null) order by e.id for update loop
  null;
 end loop;
 update public.baseline_members set name=trim(username),starting_handicap=society_handicap where id=target;
 if contact is null then
  delete from baseline_private.member_contacts where member_id=target;
  delete from public.baseline_rsvp_contacts where rsvp_id in(select id from public.baseline_rsvps where member_id=target and user_id is null);
 else
  insert into baseline_private.member_contacts(member_id,phone) values(target,contact)
  on conflict(member_id) do update set phone=excluded.phone,updated_at=now();
  insert into public.baseline_rsvp_contacts(rsvp_id,phone)
  select id,contact from public.baseline_rsvps where member_id=target and user_id is null
  on conflict(rsvp_id) do update set phone=excluded.phone;
 end if;
 update public.baseline_rsvps set name=trim(username),updated_at=now() where member_id=target and user_id is null;
 update public.baseline_tee_times t set players=(select jsonb_agg(
  case when p.value->>'member_id'=target::text and p.value->>'user_id' is null then p.value||jsonb_build_object('name',trim(username)) else p.value end order by p.ordinality)
  from jsonb_array_elements(t.players) with ordinality p(value,ordinality))
 where t.players @> jsonb_build_array(jsonb_build_object('member_id',target));
 if person.starting_handicap is distinct from society_handicap then
  perform baseline_private.league_rebuild();
  update baseline_private.league_state set revision=revision+1 where id=true;
 end if;
 insert into baseline_private.operation_audit(actor,action,details) values(auth.uid(),'edit_roster_member',
  jsonb_build_object('member_id',target,'previous_name',person.name,'name',trim(username),'previous_handicap',person.starting_handicap,'handicap',society_handicap,'has_mobile',contact is not null));
end $$;
create function public.baseline_admin_save_roster_member(target uuid,username text,mobile text,society_handicap numeric)
returns void language sql security invoker set search_path='' as $$select baseline_private.admin_save_roster_member(target,username,mobile,society_handicap);$$;
revoke all on function baseline_private.admin_save_roster_member(uuid,text,text,numeric),public.baseline_admin_save_roster_member(uuid,text,text,numeric) from public,anon;
grant execute on function baseline_private.admin_save_roster_member(uuid,text,text,numeric),public.baseline_admin_save_roster_member(uuid,text,text,numeric) to authenticated;

-- New offline bookings use the saved organiser contact.
CREATE OR REPLACE FUNCTION baseline_private.submit_rsvp(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 caller uuid:=auth.uid(); member uuid; ev public.baseline_events; old public.baseline_rsvps;
 saved public.baseline_rsvps; person public.profiles; wants boolean; needs_buggy boolean;
 roster_id uuid; roster_name text; pref text; occupied integer; candidate record; force_wait boolean;
begin
 if caller is null then raise exception 'Sign in to save your RSVP'; end if;
 if payload ? 'member_id' then
  if not public.is_admin() then raise exception 'Organiser access required'; end if;
  perform pg_advisory_xact_lock(2027,501);
  roster_id:=(payload->>'member_id')::uuid;
  select name into roster_name from public.baseline_members where id=roster_id and not invite_only for update;
  if roster_name is null then raise exception 'Choose a member from the list'; end if;
  select a.user_id into member from public.baseline_member_accounts a where a.member_id=roster_id;
  if payload->>'user_id' is not null and (payload->>'user_id')::uuid is distinct from member then raise exception 'Member account changed. Reload the member list'; end if;
 else
  member:=coalesce((payload->>'user_id')::uuid,caller);
  select a.member_id into roster_id from public.baseline_member_accounts a where a.user_id=member;
 end if;
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
 if member is not null and (person.id is null or length(trim(person.full_name)) not between 1 and 150) then raise exception 'Add your name in My account first'; end if;
 if member is null and roster_id is null then raise exception 'Choose a member from the list'; end if;
 if jsonb_typeof(payload->'attending') is distinct from 'boolean' then raise exception 'Choose whether you are playing'; end if;
 wants:=(payload->>'attending')::boolean;
 select * into old from public.baseline_rsvps where event_id=ev.id and (user_id=member or member_id=roster_id) for update;
 if old.id is not null and not public.is_admin() and (now() at time zone 'Europe/London')::date >= ev.date - 6 then
  raise exception 'Online RSVP changes close six days before the event. Contact the committee to change your RSVP';
 end if;
 if wants and not public.is_admin() and ev.rsvp_deadline is not null and (now() at time zone 'Europe/London')::date>ev.rsvp_deadline and not exists(select 1 from public.baseline_rsvps where event_id=ev.id and user_id=member and (attending or reserve)) then raise exception 'The RSVP deadline has passed. Contact an organiser'; end if;
 if wants and not public.is_admin() and length(coalesce(ev.cancellation_terms,''))>0 and payload->>'accept_terms' is distinct from 'true' and not exists(select 1 from public.baseline_rsvps where event_id=ev.id and user_id=member and (attending or reserve) and terms_snapshot=ev.cancellation_terms) then raise exception 'Accept the cancellation terms before booking'; end if;
 needs_buggy:=ev.event_type<>'social' and wants and coalesce((payload->>'buggy')::boolean,false);
 pref:=case when wants and ev.event_type<>'social' then payload->>'preferred_time' else null end;
 if pref is not null and pref not in ('First','Middle','End') then raise exception 'Choose First, Middle or End'; end if;
 force_wait:=coalesce((payload->>'reserve')::boolean,false) and wants;
 -- The event row serializes all writes; update the existing identity rather than
 -- inserting a second booking when an offline member later registers.
 if old.id is null then
  insert into public.baseline_rsvps(event_id,user_id,member_id,name,attending,reserve,buggy,preferred_time,flexibility)
  values(ev.id,member,roster_id,coalesce(trim(person.full_name),roster_name),false,wants,needs_buggy,pref,null)
  returning * into saved;
 else
  update public.baseline_rsvps set name=coalesce(trim(person.full_name),roster_name),
   user_id=member,member_id=roster_id,
   attending=wants and old.attending and not force_wait,
   reserve=wants and (not old.attending or old.reserve or force_wait),buggy=needs_buggy,preferred_time=pref,
   requested_at=case when old.attending or old.reserve then old.requested_at else now() end,updated_at=now()
  where id=old.id returning * into saved;
 end if;
 update public.baseline_rsvps set flexibility=case when needs_buggy and payload->>'flexibility'='walk' then 'walk' else null end,
 terms_accepted_at=case when wants and payload->>'accept_terms'='true' then now() else terms_accepted_at end,
 terms_snapshot=case when wants and payload->>'accept_terms'='true' then ev.cancellation_terms else terms_snapshot end where id=saved.id;
 -- Keep a valid saved contact private. It is never included in the public tee sheet.
 if member is null then select phone into person.phone from baseline_private.member_contacts where member_id=roster_id; end if;
 if length(trim(coalesce(person.phone,''))) between 5 and 40 then
  insert into public.baseline_rsvp_contacts(rsvp_id,phone) values(saved.id,trim(person.phone))
  on conflict(rsvp_id) do update set phone=excluded.phone;
 elsif member is not null then
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
  (old.id is null or old.attending is distinct from saved.attending or old.reserve is distinct from saved.reserve or old.buggy is distinct from saved.buggy) then
  update public.baseline_events set tee_times_dirty=true where id=ev.id;
 end if;
 if public.is_admin() then
  insert into baseline_private.operation_audit(actor,action,details) values(caller,'admin_rsvp',
   jsonb_build_object('event_id',ev.id,'member_id',roster_id,'user_id',member,'before',to_jsonb(old),'after',to_jsonb(saved)));
 end if;
 return jsonb_build_object('id',saved.id,'attending',saved.attending,'reserve',saved.reserve,
  'buggy',saved.buggy,'preferred_time',saved.preferred_time);
end $function$;

create or replace function baseline_private.attach_member_bookings(who uuid, account_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare ev record; start_h numeric;
begin
 if not exists(select 1 from public.baseline_member_accounts where member_id=who and user_id=account_id and not disabled) then raise exception 'Member account does not match'; end if;
 perform pg_advisory_xact_lock(2027,501);
 -- Registration supplies a valid mobile number on the linked profile.
 delete from baseline_private.member_contacts where member_id=who;
 -- Preserve the organiser-set starting handicap even if no event was booked yet.
 if not exists(select 1 from public.baseline_rsvps where member_id=who and user_id is null) then
  select starting_handicap into start_h from public.baseline_members where id=who;
  if start_h is not null then update public.profiles set handicap=start_h where id=account_id; end if;
  return;
 end if;
 for ev in select e.id from public.baseline_events e where exists(select 1 from public.baseline_rsvps r where r.event_id=e.id and r.member_id=who and r.user_id is null) order by e.id for update loop
  if exists(select 1 from public.baseline_rsvps where event_id=ev.id and user_id=account_id) then raise exception 'An existing booking needs organiser help before linking this name'; end if;
 end loop;
 update public.baseline_rsvps set user_id=account_id,attending=attending,updated_at=now() where member_id=who and user_id is null;
 insert into public.baseline_rsvp_contacts(rsvp_id,phone)
 select r.id,p.phone from public.baseline_rsvps r join public.profiles p on p.id=r.user_id
 where r.member_id=who and r.user_id=account_id and length(trim(p.phone)) between 5 and 40
 on conflict(rsvp_id) do update set phone=excluded.phone;
 update public.baseline_tee_times t set players=(select jsonb_agg(case when p->>'member_id'=who::text and p->>'user_id' is null
  then p||jsonb_build_object('user_id',account_id,'participant_id',account_id) else p end order by ord)
  from jsonb_array_elements(t.players) with ordinality a(p,ord))
 where t.players @> jsonb_build_array(jsonb_build_object('member_id',who));
 update baseline_private.league_rounds r set
  draft=(select coalesce(jsonb_agg(case when x->>'user_id'=who::text then x||jsonb_build_object('user_id',account_id) else x end order by ord),'[]'::jsonb) from jsonb_array_elements(r.draft) with ordinality a(x,ord)),
  published_entries=(select jsonb_agg(case when x->>'user_id'=who::text then x||jsonb_build_object('user_id',account_id) else x end order by ord) from jsonb_array_elements(r.published_entries) with ordinality a(x,ord)),
  results=(select coalesce(jsonb_agg(case when x->>'user_id'=who::text then x||jsonb_build_object('user_id',account_id) else x end order by ord),'[]'::jsonb) from jsonb_array_elements(r.results) with ordinality a(x,ord)),
  winner=case when r.winner=who then account_id else r.winner end,
  draft_winner=case when r.draft_winner=who then account_id else r.draft_winner end
 where r.draft @> jsonb_build_array(jsonb_build_object('user_id',who))
    or r.published_entries @> jsonb_build_array(jsonb_build_object('user_id',who))
    or r.results @> jsonb_build_array(jsonb_build_object('user_id',who));
 select starting_handicap into start_h from public.baseline_members where id=who;
 if start_h is not null then update public.profiles set handicap=start_h where id=account_id; end if;
 perform baseline_private.league_rebuild();
 update baseline_private.league_state set revision=revision+1 where id=true;
end $$;

notify pgrst, 'reload schema';
