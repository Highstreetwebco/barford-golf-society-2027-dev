-- Book existing roster members without creating authentication accounts.
-- Account ownership remains auth.uid(); roster IDs are never authentication IDs.
alter table public.baseline_rsvps alter column user_id drop not null;
alter table public.baseline_rsvps add column member_id uuid references public.baseline_members(id);
update public.baseline_rsvps r set member_id=a.member_id
from public.baseline_member_accounts a where a.user_id=r.user_id;
alter table public.baseline_rsvps add constraint baseline_rsvp_has_identity check(user_id is not null or member_id is not null);
alter table public.baseline_rsvps add constraint baseline_rsvp_one_per_roster unique(event_id,member_id);
create index baseline_rsvps_member_idx on public.baseline_rsvps(member_id);
alter table public.baseline_rsvps add column participant_id uuid generated always as (coalesce(user_id,member_id)) stored;
alter table public.baseline_members add column starting_handicap numeric
  check(starting_handicap between 0 and 36 and round(starting_handicap,1)=starting_handicap);

-- Internal identity source for scoring. Include unregistered members only after
-- they have a booking, retaining them in results even after a withdrawal.
create function baseline_private.league_participants()
returns table(id uuid,full_name text,handicap numeric) language sql stable security definer set search_path='' as $$
 select p.id,p.full_name,p.handicap from public.profiles p
 join public.baseline_member_accounts a on a.user_id=p.id where not a.disabled
 union all
 select m.id,m.name,m.starting_handicap from public.baseline_members m
 where not exists(select 1 from public.baseline_member_accounts a where a.member_id=m.id)
 and exists(select 1 from public.baseline_rsvps r where r.member_id=m.id);
$$;
revoke all on function baseline_private.league_participants() from public,anon,authenticated;

create function baseline_private.admin_booking_members(event bigint)
returns table(id uuid,name text,user_id uuid,booking_id bigint,attending boolean,reserve boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 if not exists(select 1 from public.baseline_events where baseline_events.id=event) then raise exception 'Choose an event first'; end if;
 return query select m.id,m.name,a.user_id,r.id,r.attending,r.reserve
 from public.baseline_members m left join public.baseline_member_accounts a on a.member_id=m.id
 left join public.baseline_rsvps r on r.event_id=event and (r.member_id=m.id or r.user_id=a.user_id)
 where not m.invite_only and not coalesce(a.disabled,false) order by lower(m.name);
end $$;
create function public.baseline_admin_booking_members(event bigint)
returns table(id uuid,name text,user_id uuid,booking_id bigint,attending boolean,reserve boolean)
language sql stable security invoker set search_path='' as $$select * from baseline_private.admin_booking_members(event);$$;
revoke all on function baseline_private.admin_booking_members(bigint),public.baseline_admin_booking_members(bigint) from public,anon;
grant execute on function baseline_private.admin_booking_members(bigint),public.baseline_admin_booking_members(bigint) to authenticated;

CREATE OR REPLACE FUNCTION baseline_private.sync_charge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ev public.baseline_events; cat text; cost numeric;
begin
 -- An offline booking has no login or payment account yet.
 if new.user_id is null then return new; end if;
 select * into ev from public.baseline_events where id=new.event_id;
 cat:=case when new.guest_host_id is not null then 'guest' else coalesce((select category from baseline_private.member_types where user_id=new.user_id),'member') end;
 cost:=case when cat='guest' then ev.guest_price else ev.member_price end;
 if new.attending and not new.reserve and cost is not null then
 insert into baseline_private.charges(user_id,event_id,scope,label,category,amount,due_date) values(new.user_id,new.event_id,'event:'||new.event_id,ev.name,cat,cost,ev.payment_due)
 on conflict(user_id,scope) do update set cancellation_review=false,revision=baseline_private.charges.revision+1;
 elsif tg_op='UPDATE' and old.attending and not old.reserve and not new.attending then
 update baseline_private.charges set cancellation_review=true,revision=revision+1 where user_id=new.user_id and event_id=new.event_id;
 update baseline_private.playing_pairs set status='looking',second_user=null,first_user=case when first_user=new.user_id and second_user is not null then second_user else first_user end,updated_at=now() where event_id=new.event_id and new.user_id in(first_user,second_user);
 delete from baseline_private.playing_pairs where event_id=new.event_id and first_user=new.user_id;
 end if;
 return new;
end $function$;

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

CREATE OR REPLACE FUNCTION baseline_private.league_admin()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 return jsonb_build_object('revision',(select revision from baseline_private.league_state),'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'starting_handicap',p.handicap,'offline',not exists(select 1 from public.profiles where id=p.id),'adjustments',coalesce((select jsonb_agg(to_jsonb(o) order by round_number) from baseline_private.handicap_overrides o where o.user_id=p.id),'[]'::jsonb)) order by lower(p.full_name)) from baseline_private.league_participants() p),'[]'::jsonb),'rounds',coalesce((select jsonb_agg(to_jsonb(r) order by round_number) from baseline_private.league_rounds r),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION baseline_private.league_board()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cutoff integer:=5; rounds_json jsonb; players_json jsonb;
begin
 if public.is_admin() then cutoff:=7; end if;
 select coalesce(jsonb_agg(jsonb_build_object('round',r.round_number,'event_id',r.event_id,'published_at',r.published_at,'average',r.average,'results',(select jsonb_agg(x||jsonb_build_object('automatic_next_handicap',x->'next_handicap','next_handicap',coalesce((select to_jsonb(o.handicap) from baseline_private.handicap_overrides o where o.user_id=(x->>'user_id')::uuid and o.round_number=r.round_number+1),x->'next_handicap'),'committee_adjusted',exists(select 1 from baseline_private.handicap_overrides o where o.user_id=(x->>'user_id')::uuid and o.round_number=r.round_number+1))) from jsonb_array_elements(r.results) x)) order by r.round_number),'[]') into rounds_json from baseline_private.league_rounds r where r.round_number<=cutoff and r.published_entries is not null;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'starting_handicap',p.handicap) order by lower(p.full_name)),'[]') into players_json from baseline_private.league_participants() p;
 return jsonb_build_object('players',players_json,'rounds',rounds_json,'visible_rounds',cutoff);
end $function$;

CREATE OR REPLACE FUNCTION baseline_private.league_rebuild()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rr record; pp record; running jsonb:='{}'; out_rows jsonb; h numeric; pts integer; adjustment integer; av integer; n integer;
begin
 for rr in select * from baseline_private.league_rounds where published_entries is not null order by round_number loop
  select count(*) into n from jsonb_array_elements(rr.published_entries) x where (x->>'points')::integer>0;
  select floor(avg(points)+0.5)::integer into av from (
   select (x->>'points')::integer points,row_number() over(order by (x->>'points')::integer) pos
   from jsonb_array_elements(rr.published_entries) x where (x->>'points')::integer>0
  ) t where n<=4 or (pos>1 and pos<n);
  out_rows:='[]';
  for pp in select p.id,p.handicap from baseline_private.league_participants() p order by p.id loop
   h:=coalesce((select handicap from baseline_private.handicap_overrides where user_id=pp.id and round_number=rr.round_number),(running->>pp.id::text)::numeric,pp.handicap);
   select (x->>'points')::integer into pts from jsonb_array_elements(rr.published_entries) x where x->>'user_id'=pp.id::text;
   if pts is not null and h is null then raise exception 'Set the starting handicap for every player with a score'; end if;
   adjustment:=case when pts is null then 0 else baseline_private.league_adjustment(pts,av,h) end;
   out_rows:=out_rows||jsonb_build_array(jsonb_build_object('user_id',pp.id,'handicap',h,'points',pts,'adjustment',case when pts is null then null else adjustment end,'next_handicap',case when h is null then null else greatest(0,h+adjustment) end,'winner',coalesce(pp.id=rr.winner,false)));
   if h is not null then running:=jsonb_set(running,array[pp.id::text],to_jsonb(greatest(0,h+adjustment))); end if;
  end loop;
  update baseline_private.league_rounds set average=av,results=out_rows where event_id=rr.event_id;
 end loop;
end $function$;

CREATE OR REPLACE FUNCTION baseline_private.handicap_at(who uuid, target_round integer)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare h numeric; previous integer:=0; v numeric;
begin
 select handicap into h from baseline_private.league_participants() where id=who;
 select r.round_number,(x->>'next_handicap')::numeric into previous,v from baseline_private.league_rounds r cross join lateral jsonb_array_elements(r.results) x
 where r.published_entries is not null and r.round_number<target_round and x->>'user_id'=who::text order by r.round_number desc limit 1;
 if found then h:=v; end if;
 select handicap into v from baseline_private.handicap_overrides where user_id=who and round_number>coalesce(previous,0) and round_number<=target_round order by round_number desc limit 1;
 if found then h:=v; end if;
 return h;
end $function$;

CREATE OR REPLACE FUNCTION baseline_private.league_save_round(event bigint, entries jsonb, chosen_winner uuid, publish boolean, expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ev public.baseline_events; entry jsonb; pts integer; uid uuid; cleaned jsonb:='[]'; high integer; winner_id uuid; leaders integer; cnt integer;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 perform pg_advisory_xact_lock(2027,501);
 if expected_revision is distinct from (select revision from baseline_private.league_state) then raise exception 'Scores or handicaps changed. Reload before saving'; end if;
 select * into ev from public.baseline_events where id=event for update;
 if ev.id is null or ev.round_number is null then raise exception 'Assign a league round to this event first'; end if;
 if ev.cancelled then raise exception 'Reopen this event before entering scores'; end if;
 if entries is null or jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>200 then raise exception 'Invalid score list'; end if;
 if (select count(*)<>count(distinct x->>'user_id') from jsonb_array_elements(entries) x) then raise exception 'Duplicate player'; end if;
 for entry in select * from jsonb_array_elements(entries) loop
  uid:=(entry->>'user_id')::uuid;
  if not exists(select 1 from baseline_private.league_participants() where id=uid) then raise exception 'Choose a member'; end if;
  if coalesce(entry->>'status','') not in ('played','dnp','pending') then raise exception 'Choose score or DNP for each player'; end if;
  pts:=case when entry->>'status'='played' then (entry->>'points')::integer else null end;
  if entry->>'status'='played' and (pts is null or pts not between 1 and 108) then raise exception 'Enter 1 to 108 points, or choose DNP for zero'; end if;
  if publish and entry->>'status'='pending' then raise exception 'Complete every score or mark DNP before publishing'; end if;
  cleaned:=cleaned||jsonb_build_array(jsonb_build_object('user_id',uid,'points',pts,'status',entry->>'status'));
 end loop;
 if publish then
  if exists(select 1 from generate_series(1,ev.round_number-1) n where not exists(select 1 from baseline_private.league_rounds r where r.round_number=n and published_entries is not null)) then raise exception 'Publish earlier rounds first so handicaps are correct'; end if;
  if exists(select 1 from public.baseline_rsvps r where r.event_id=event and r.attending and not r.reserve and not exists(select 1 from jsonb_array_elements(cleaned) x where x->>'user_id'=r.participant_id::text)) then raise exception 'The RSVP list changed. Reload and complete every confirmed player'; end if;
  select count(*),max((x->>'points')::integer) into cnt,high from jsonb_array_elements(cleaned) x where x->>'points' is not null;
  if cnt<4 then raise exception 'At least four played scores are needed for handicap calculation'; end if;
  select count(*) into leaders from jsonb_array_elements(cleaned) x where (x->>'points')::integer=high;
  if leaders=1 then select (x->>'user_id')::uuid into winner_id from jsonb_array_elements(cleaned) x where (x->>'points')::integer=high;
  else
   if chosen_winner is null or not exists(select 1 from jsonb_array_elements(cleaned) x where (x->>'points')::integer=high and x->>'user_id'=chosen_winner::text) then raise exception 'Select the winner from the tied top scorers after countback'; end if;
   winner_id:=chosen_winner;
  end if;
 end if;
 insert into baseline_private.league_rounds(event_id,round_number,draft,draft_winner) values(event,ev.round_number,cleaned,chosen_winner)
 on conflict(event_id) do update set draft=excluded.draft,draft_winner=excluded.draft_winner,updated_at=now();
 if publish then
  update baseline_private.league_rounds set published_entries=cleaned,winner=winner_id,published_at=now() where event_id=event;
  perform baseline_private.league_rebuild();
 end if;
 update baseline_private.league_state set revision=revision+1 where id=true;
 insert into baseline_private.league_audit(actor,action,details) values(auth.uid(),case when publish then 'publish_round' else 'save_draft' end,jsonb_build_object('event',event,'round',ev.round_number,'entries',cleaned,'winner',winner_id));
 return baseline_private.league_admin();
end $function$;

CREATE OR REPLACE FUNCTION baseline_private.league_save_handicaps(entries jsonb, expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare entry jsonb; h numeric; uid uuid;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 perform pg_advisory_xact_lock(2027,501);
 if expected_revision is distinct from (select revision from baseline_private.league_state) then raise exception 'Scores or handicaps changed. Reload before saving'; end if;
 if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>200 then raise exception 'Invalid handicap list'; end if;
 if (select count(*)<>count(distinct x->>'user_id') from jsonb_array_elements(entries) x) then raise exception 'Duplicate player'; end if;
 for entry in select * from jsonb_array_elements(entries) loop
  uid:=(entry->>'user_id')::uuid; h:=(entry->>'handicap')::numeric;
  if not exists(select 1 from baseline_private.league_participants() where id=uid) then raise exception 'Choose a member'; end if;
  if h is not null and (h::text in ('NaN','Infinity','-Infinity') or h<0 or h>36 or round(h,1)<>h) then raise exception 'Starting handicap must be 0 to 36, with at most one decimal place'; end if;
  if exists(select 1 from public.profiles where id=uid) then
   update public.profiles set handicap=h where id=uid and handicap is distinct from h;
  else
   if h is null and exists(select 1 from baseline_private.league_rounds r,jsonb_array_elements(r.published_entries) x where x->>'user_id'=uid::text and x->>'points' is not null) then raise exception 'A player with published scores needs a starting handicap'; end if;
   update public.baseline_members set starting_handicap=h where id=uid and starting_handicap is distinct from h;
   if found then
    perform baseline_private.league_rebuild();
    update baseline_private.league_state set revision=revision+1 where id=true;
   end if;
  end if;
 end loop;
 insert into baseline_private.league_audit(actor,action,details) values(auth.uid(),'starting_handicaps',entries);
 return baseline_private.league_admin();
end $function$;

CREATE OR REPLACE FUNCTION baseline_private.save_tee_times(event bigint, groups jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g jsonb; player jsonb; roster jsonb; r public.baseline_rsvps; seen uuid[]:='{}'; n integer:=0; uid uuid; previous jsonb; changed record;
begin
 if not public.is_admin() then raise exception 'Organiser access required'; end if;
 perform 1 from public.baseline_events where id=event for update;
 if not found then raise exception 'Event not found'; end if;
 if jsonb_typeof(groups) is distinct from 'array' then raise exception 'Invalid tee groups'; end if;
 if exists(select 1 from public.baseline_events where id=event and (event_type='social' or cancelled)) then raise exception 'Tee groups are only available for active golf events'; end if;
 select coalesce(jsonb_object_agg(coalesce(p->>'participant_id',p->>'user_id'),jsonb_build_object('time',t.tee_time,'group',t.group_number,'players',t.players)),'{}') into previous from public.baseline_tee_times t cross join lateral jsonb_array_elements(t.players) p where t.event_id=event;
 delete from public.baseline_tee_times where event_id=event;
 for g in select value from jsonb_array_elements(groups) loop
  if g->>'time' is null or g->>'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Enter a valid tee time'; end if;
  if jsonb_typeof(g->'players') is distinct from 'array' or jsonb_array_length(g->'players') not between 1 and 4 then raise exception 'Each group needs one to four players'; end if;
  roster:='[]'::jsonb;
  for player in select value from jsonb_array_elements(g->'players') loop
   uid:=(player#>>'{}')::uuid;
   if uid=any(seen) then raise exception 'A player appears more than once'; end if;
   select * into r from public.baseline_rsvps where event_id=event and participant_id=uid and attending and not reserve;
   if r.id is null then raise exception 'A player is no longer confirmed. Reload RSVPs'; end if;
   seen:=array_append(seen,uid);
   roster:=roster||jsonb_build_array(jsonb_build_object('participant_id',uid,'user_id',r.user_id,'member_id',r.member_id,'name',r.name,'type',case when r.buggy then 'buggy' else 'walker' end));
  end loop;
  n:=n+1;
  insert into public.baseline_tee_times(event_id,group_number,tee_time,players) values(event,n,g->>'time',roster);
 end loop;
 if cardinality(seen)<>(select count(*) from public.baseline_rsvps where event_id=event and attending and not reserve) then
  raise exception 'Include every confirmed player before publishing';
 end if;
 if exists(select 1 from baseline_private.playing_pairs p where p.event_id=event and p.status='confirmed' and not exists(select 1 from public.baseline_tee_times t where t.event_id=event and t.players @> jsonb_build_array(jsonb_build_object('user_id',p.first_user),jsonb_build_object('user_id',p.second_user)))) then raise exception 'Keep confirmed playing partners in the same tee group'; end if;
 update public.baseline_events set tee_revision=tee_revision+1,tee_published_at=now() where id=event;
 for changed in select (p->>'user_id')::uuid uid,t.tee_time,t.group_number,t.players from public.baseline_tee_times t cross join lateral jsonb_array_elements(t.players) p where t.event_id=event and p->>'user_id' is not null loop
 if previous ? changed.uid::text and previous->changed.uid::text is distinct from jsonb_build_object('time',changed.tee_time,'group',changed.group_number,'players',changed.players) then
 insert into baseline_private.tee_changes(event_id,user_id,old_time,new_time,revision) values(event,changed.uid,previous->changed.uid::text->>'time',changed.tee_time,(select tee_revision from public.baseline_events where id=event)); end if;
 end loop;
 -- Pair buggy players within their published group. Preserve a booking owner only when the same pair remains.
 with numbered as (
 select t.group_number,(p.value->>'user_id')::uuid as uid,row_number() over(partition by t.group_number order by p.ordinality) as rn
 from public.baseline_tee_times t cross join lateral jsonb_array_elements(t.players) with ordinality p(value,ordinality)
 where t.event_id=event and p.value->>'type'='buggy'
 ), pairs as (select least(a.uid,b.uid) u1,greatest(a.uid,b.uid) u2 from numbered a join numbered b on b.group_number=a.group_number and b.rn=a.rn+1 where a.rn%2=1 and a.uid is not null and b.uid is not null)
 delete from public.baseline_buggy_pairs bp where bp.event_id=event and not exists(select 1 from pairs p where p.u1=bp.first_user and p.u2=bp.second_user);
 with numbered as (
 select t.group_number,(p.value->>'user_id')::uuid as uid,row_number() over(partition by t.group_number order by p.ordinality) as rn
 from public.baseline_tee_times t cross join lateral jsonb_array_elements(t.players) with ordinality p(value,ordinality)
 where t.event_id=event and p.value->>'type'='buggy'
 ) insert into public.baseline_buggy_pairs(event_id,first_user,second_user)
 select event,least(a.uid,b.uid),greatest(a.uid,b.uid) from numbered a join numbered b on b.group_number=a.group_number and b.rn=a.rn+1 where a.rn%2=1 and a.uid is not null and b.uid is not null on conflict(event_id,first_user,second_user) do nothing;
 update public.baseline_events set tee_times_dirty=false where id=event;
end $function$;

CREATE OR REPLACE FUNCTION baseline_private.event_tee_groups(event bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ev public.baseline_events; groups_json jsonb; secret boolean; provisional boolean;
begin
 if not baseline_private.active_member() then raise exception 'Member sign-in required'; end if;
 select * into ev from public.baseline_events where id=event;
 if ev.id is null then raise exception 'Event not found'; end if;
 if ev.cancelled or ev.tee_times_dirty then return jsonb_build_object('status',case when ev.cancelled then 'cancelled' else 'reviewing' end,'groups','[]'::jsonb); end if;
 secret:=ev.round_number>=7 and not public.is_admin();
 provisional:=exists(select 1 from generate_series(1,ev.round_number-1) n where not exists(select 1 from baseline_private.league_rounds r where r.round_number=n and r.published_entries is not null));
 select coalesce(jsonb_agg(jsonb_build_object('group_number',t.group_number,'tee_time',t.tee_time,'players',(
  select coalesce(jsonb_agg(jsonb_build_object('participant_id',coalesce(a.value->>'participant_id',a.value->>'user_id'),'user_id',p.id,'name',coalesce(p.full_name,r.name)||case when exists(select 1 from public.baseline_rsvps gr where gr.event_id=event and gr.user_id=p.id and gr.guest_host_id is not null) then ' (guest)' else '' end,'avatar_path',p.baseline_avatar_path,'handicap',case when secret then null else baseline_private.handicap_at(r.participant_id,coalesce(ev.round_number,1)) end,'handicap_secret',coalesce(secret,false),'type',a.value->>'type') order by a.ordinality),'[]'::jsonb)
  from jsonb_array_elements(t.players) with ordinality a(value,ordinality) join public.baseline_rsvps r on r.event_id=event and r.participant_id::text=coalesce(a.value->>'participant_id',a.value->>'user_id') left join public.profiles p on p.id=r.user_id left join public.baseline_member_accounts m on m.user_id=p.id where not coalesce(m.disabled,false)
 )) order by t.group_number),'[]'::jsonb) into groups_json from public.baseline_tee_times t where t.event_id=event;
 return jsonb_build_object('status',case when jsonb_array_length(groups_json)=0 then 'unpublished' else 'published' end,'published_at',ev.tee_published_at,'revision',ev.tee_revision,'round_number',ev.round_number,'provisional',case when secret then false else provisional end,'groups',groups_json);
end $function$;

CREATE OR REPLACE FUNCTION baseline_private.event_payment_overview(event bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); own jsonb;
begin
 if not baseline_private.active_member() then raise exception 'Member sign-in required'; end if;
 if not exists(select 1 from public.baseline_events where id=event) then raise exception 'Event not found'; end if;
 select jsonb_build_object('id',c.id,'amount',c.amount,'received',c.received,'reported',c.reported)
 into own from baseline_private.charges c where c.event_id=event and c.user_id=uid;
 return jsonb_build_object('own_charge',own,'players',coalesce((
  select jsonb_agg(jsonb_build_object('participant_id',r.participant_id,'user_id',r.user_id,'status',
    case when c.id is not null and c.received>=c.amount then 'paid'
         when coalesce(c.reported,false) then 'pending' else 'unpaid' end) order by lower(r.name))
  from public.baseline_rsvps r left join baseline_private.charges c
   on c.event_id=r.event_id and c.user_id=r.user_id
  where r.event_id=event and r.attending and not r.reserve
 ),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION baseline_private.operations(action text, payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); eid bigint:=(payload->>'event_id')::bigint; target uuid; ev public.baseline_events; invitation baseline_private.guest_requests; pair baseline_private.playing_pairs; charge baseline_private.charges; oldrow jsonb; item baseline_private.committee_items; roster_id uuid; h numeric; cost numeric; cat text; result jsonb; settings baseline_private.operations_settings;
begin
 if not baseline_private.active_member() then raise exception 'Member sign-in required'; end if;
 if action='member' then
  select * into settings from baseline_private.operations_settings;
  return jsonb_build_object('settings',to_jsonb(settings),'category',coalesce((select category from baseline_private.member_types where user_id=uid),'member'),
   'charges',coalesce((select jsonb_agg(to_jsonb(c) - 'note' order by due_date,id) from baseline_private.charges c where user_id=uid),'[]'::jsonb),
   'guests',coalesce((select jsonb_agg(to_jsonb(g) order by created_at desc) from baseline_private.guest_requests g where host_id=uid and (eid is null or event_id=eid)),'[]'::jsonb),
   'changes',coalesce((select jsonb_agg(to_jsonb(t) order by created_at desc) from baseline_private.tee_changes t where user_id=uid and not seen and (eid is null or event_id=eid)),'[]'::jsonb),
   'pairs',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'first_user',p.first_user,'second_user',p.second_user,'status',p.status,'first_name',a.full_name,'second_name',b.full_name)) from baseline_private.playing_pairs p join public.profiles a on a.id=p.first_user left join public.profiles b on b.id=p.second_user where p.event_id=eid),'[]'::jsonb),
   'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) order by p.full_name) from public.profiles p join public.baseline_rsvps r on r.user_id=p.id where r.event_id=eid and r.attending and not r.reserve),'[]'::jsonb));
 elsif action='report_payment' then
  update baseline_private.charges set reported=true,revision=revision+1,updated_at=now() where id=(payload->>'id')::bigint and user_id=uid and amount>received;
  if not found then raise exception 'No unpaid charge found'; end if;
 elsif action='course_member' then
  update baseline_private.charges set note=concat_ws(E'\n',nullif(note,''),'Course-member discount requested by player'),revision=revision+1,updated_at=now() where event_id=eid and user_id=uid;
  if not found then raise exception 'An organiser must set the event price first'; end if;
 elsif action='seen_changes' then
  update baseline_private.tee_changes set seen=true where user_id=uid and event_id=eid;
 elsif action='invite_guest' then
  select * into ev from public.baseline_events where id=eid;
  if ev.id is null or ev.cancelled or ev.date<(now() at time zone 'Europe/London')::date then raise exception 'Choose an upcoming event'; end if;
  if ev.rsvp_deadline is not null and (now() at time zone 'Europe/London')::date>ev.rsvp_deadline then raise exception 'Contact an organiser for a late guest request'; end if;
  if (select count(*) from baseline_private.guest_requests where host_id=uid and created_at>now()-interval '1 day')>=10 then raise exception 'Contact an organiser for further invitations'; end if;
  h:=(payload->>'handicap')::numeric;
  if h is not null and (h::text in ('NaN','Infinity','-Infinity') or h<0 or h>54) then raise exception 'Enter a valid suggested handicap'; end if;
  insert into baseline_private.guest_requests(host_id,event_id,name,phone,requested_handicap) values(uid,eid,trim(payload->>'name'),trim(payload->>'phone'),h);
 elsif action='pair' then
  select * into ev from public.baseline_events where id=eid for update;
  if ev.event_type is distinct from 'pairs' or ev.cancelled or ev.date<(now() at time zone 'Europe/London')::date then raise exception 'Choose an upcoming pairs event'; end if;
  target:=coalesce((payload->>'user_id')::uuid,uid);
  if target<>uid and not public.is_admin() then raise exception 'You can only change your own partner request'; end if;
  if not exists(select 1 from public.baseline_rsvps where event_id=eid and user_id=target and attending and not reserve) then raise exception 'Confirm your place before choosing a partner'; end if;
  if payload->>'mode' in ('accept','decline','clear') then
   select * into pair from baseline_private.playing_pairs where id=(payload->>'id')::bigint and event_id=eid for update;
   if pair.id is null or (target not in(pair.first_user,coalesce(pair.second_user,pair.first_user)) and not public.is_admin()) then raise exception 'This is not your partner request'; end if;
   if payload->>'mode'='accept' then
    if (pair.second_user is distinct from uid and not public.is_admin()) or pair.status<>'requested' then raise exception 'Only the invited partner can accept'; end if;
    if (select count(*) from public.baseline_rsvps where event_id=eid and user_id in(pair.first_user,pair.second_user) and attending and not reserve)<>2 then raise exception 'Both partners must have confirmed places'; end if;
    update baseline_private.playing_pairs set status='confirmed',updated_at=now() where id=pair.id;
   else delete from baseline_private.playing_pairs where id=pair.id; end if;
  else
   if exists(select 1 from baseline_private.playing_pairs where event_id=eid and target in(first_user,second_user)) then raise exception 'Clear your existing partner request first'; end if;
   roster_id:=(payload->>'partner_id')::uuid;
   if roster_id is not null then
    if roster_id=target or not exists(select 1 from public.baseline_rsvps where event_id=eid and user_id=roster_id and attending and not reserve) then raise exception 'Choose another confirmed player'; end if;
    if exists(select 1 from baseline_private.playing_pairs where event_id=eid and roster_id in(first_user,second_user) and status<>'looking') then raise exception 'That player already has a partner request'; end if;
    delete from baseline_private.playing_pairs where event_id=eid and first_user=roster_id and status='looking';
   end if;
   insert into baseline_private.playing_pairs(event_id,first_user,second_user,status) values(eid,target,roster_id,case when roster_id is null then 'looking' when public.is_admin() and payload->>'confirmed'='true' then 'confirmed' else 'requested' end);
  end if;
  if exists(select 1 from public.baseline_tee_times where event_id=eid) then update public.baseline_events set tee_times_dirty=true where id=eid; end if;
 elsif action='confirm_buggy' then
  result:=baseline_private.buggy_details(eid,false,false);
  if result->>'status'<>'paired' or result->>'booking_me' is distinct from 'true' then raise exception 'Only the assigned booking owner can confirm the reservation'; end if;
  if exists(select 1 from public.baseline_events where id=eid and date<(now() at time zone 'Europe/London')::date) then raise exception 'This event has finished'; end if;
  update public.baseline_buggy_pairs set confirmed_at=case when payload->>'confirmed'='true' then now() else null end,updated_at=now() where event_id=eid and booking_user=uid;
 else
  if not public.is_admin() then raise exception 'Organiser access required'; end if;
  if action='admin' then
   return jsonb_build_object('settings',(select to_jsonb(s) from baseline_private.operations_settings s),
    'charges',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('name',p.full_name) order by c.updated_at desc) from baseline_private.charges c join public.profiles p on p.id=c.user_id),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'category',coalesce(t.category,'member')) order by p.full_name) from public.profiles p join public.baseline_member_accounts a on a.user_id=p.id left join baseline_private.member_types t on t.user_id=p.id where not a.disabled),'[]'::jsonb),
    'guests',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('host_name',p.full_name) order by g.created_at desc) from baseline_private.guest_requests g join public.profiles p on p.id=g.host_id),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(to_jsonb(t)) from baseline_private.event_tasks t where t.event_id=eid),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by updated_at desc) from baseline_private.committee_items i),'[]'::jsonb),
    'pairs',coalesce((select jsonb_agg(to_jsonb(p)) from baseline_private.playing_pairs p where p.event_id=eid),'[]'::jsonb),
    'buggies',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('first_name',a.full_name,'second_name',b.full_name,'booking_name',c.full_name)) from public.baseline_buggy_pairs p join public.profiles a on a.id=p.first_user join public.profiles b on b.id=p.second_user left join public.profiles c on c.id=p.booking_user where p.event_id=eid),'[]'::jsonb),
    'handicap_history',coalesce((select jsonb_agg(t) from (select a.*,p.full_name actor_name from baseline_private.league_audit a left join public.profiles p on p.id=a.actor where a.action='manual_handicap' order by a.created_at desc limit 100) t),'[]'::jsonb));
  elsif action='settings' then
   update baseline_private.operations_settings set bank_instructions=left(coalesce(payload->>'bank_instructions',''),2000),membership_fee=(payload->>'membership_fee')::numeric,membership_due=(payload->>'membership_due')::date,guest_policy=left(coalesce(payload->>'guest_policy',''),2000);
   if payload->>'create_membership_charges'='true' then
    insert into baseline_private.charges(user_id,scope,label,amount,due_date)
    select p.id,'membership:2027','2027 membership',s.membership_fee,s.membership_due from public.profiles p join public.baseline_member_accounts a on a.user_id=p.id cross join baseline_private.operations_settings s left join baseline_private.member_types t on t.user_id=p.id where not a.disabled and coalesce(t.category,'member')='member' and s.membership_fee is not null on conflict(user_id,scope) do nothing;
   end if;
  elsif action='member_type' then
   target:=(payload->>'user_id')::uuid;
   if not exists(select 1 from public.baseline_member_accounts where user_id=target and not disabled) then raise exception 'Choose a registered member'; end if;
   insert into baseline_private.member_types values(target,payload->>'category') on conflict(user_id) do update set category=excluded.category;
  elsif action='generate_charges' then
   select * into ev from public.baseline_events where id=eid;
   if ev.id is null then raise exception 'Choose an event'; end if;
   insert into baseline_private.charges(user_id,event_id,scope,label,category,amount,due_date)
   select r.user_id,eid,'event:'||eid,ev.name,coalesce(t.category,'member'),case when t.category='guest' then ev.guest_price else ev.member_price end,ev.payment_due
   from public.baseline_rsvps r left join baseline_private.member_types t on t.user_id=r.user_id where r.event_id=eid and r.user_id is not null and r.attending and not r.reserve and (case when t.category='guest' then ev.guest_price else ev.member_price end) is not null on conflict(user_id,scope) do nothing;
  elsif action='save_charge' then
   select * into charge from baseline_private.charges where id=(payload->>'id')::bigint for update;
   if charge.id is null or charge.revision is distinct from (payload->>'revision')::int then raise exception 'Payment changed. Reload before saving'; end if;
   oldrow:=to_jsonb(charge);
   if (payload->>'amount') is null or (payload->>'received') is null or (payload->>'amount')::numeric<0 or (payload->>'received')::numeric<0 then raise exception 'Enter valid non-negative amounts'; end if;
   update baseline_private.charges set amount=(payload->>'amount')::numeric,received=(payload->>'received')::numeric,category=payload->>'category',due_date=(payload->>'due_date')::date,note=left(coalesce(payload->>'note',''),2000),reported=case when payload->>'clear_report'='true' then false else reported end,cancellation_review=coalesce((payload->>'cancellation_review')::boolean,false),revision=revision+1,updated_at=now() where id=charge.id;
  elsif action='approve_guest' then
   select * into invitation from baseline_private.guest_requests where id=(payload->>'id')::uuid for update;
   if invitation.id is null or invitation.status<>'pending' then raise exception 'This request has already been handled'; end if;
   if payload->>'approve'='true' then
    h:=(payload->>'handicap')::numeric;
    select * into ev from public.baseline_events where id=invitation.event_id;
    if ev.event_type<>'social' and (h is null or h<0 or h>36 or round(h,1)<>h) then raise exception 'Approve a starting handicap from 0 to 36'; end if;
    select id into roster_id from public.baseline_members where lower(trim(name))=lower(trim(invitation.name));
    if roster_id is null then insert into public.baseline_members(name) values(trim(invitation.name)) returning id into roster_id; end if;
    update baseline_private.guest_requests set status='approved',approved_handicap=h,member_id=roster_id where id=invitation.id;
   else update baseline_private.guest_requests set status='rejected' where id=invitation.id; end if;
  elsif action='approve_enquiry' then
   select to_jsonb(s) into oldrow from public.baseline_signups s where id=(payload->>'id')::bigint for update;
   if oldrow is null then raise exception 'Enquiry already handled'; end if;
   if not exists(select 1 from public.baseline_members where lower(trim(name))=lower(trim(oldrow->>'name'))) then insert into public.baseline_members(name) values(trim(oldrow->>'name')); end if;
   delete from public.baseline_signups where id=(payload->>'id')::bigint;
  elsif action='task' then
   if payload->>'task' not in ('Course confirmed','Numbers submitted','Payments checked','Handicaps ready','Tee groups published','Scorecards prepared','Prizes assigned') then raise exception 'Unknown checklist item'; end if;
   insert into baseline_private.event_tasks(event_id,task,owner,done) values(eid,payload->>'task',left(coalesce(payload->>'owner',''),150),(payload->>'done')::boolean) on conflict(event_id,task) do update set owner=excluded.owner,done=excluded.done,updated_at=now();
  elsif action='item' then
   if payload->>'kind'='expense' or exists(select 1 from baseline_private.committee_items where id=(payload->>'id')::bigint and kind='expense') then raise exception 'Use Expenses to upload a receipt or mark an expense paid'; end if;
 
   if payload->>'id' is not null then
    select * into item from baseline_private.committee_items where id=(payload->>'id')::bigint for update;
    if item.id is null or item.revision is distinct from (payload->>'revision')::int then raise exception 'Item changed. Reload before saving'; end if;
    oldrow:=to_jsonb(item);
    update baseline_private.committee_items set description=trim(payload->>'description'),owner=left(coalesce(payload->>'owner',''),150),amount=(payload->>'amount')::numeric,quantity=(payload->>'quantity')::int,done=(payload->>'done')::boolean,note=left(coalesce(payload->>'note',''),1000),revision=revision+1,updated_at=now() where id=item.id;
   else insert into baseline_private.committee_items(kind,description,owner,amount,quantity,note) values(payload->>'kind',trim(payload->>'description'),left(coalesce(payload->>'owner',''),150),(payload->>'amount')::numeric,(payload->>'quantity')::int,left(coalesce(payload->>'note',''),1000)); end if;
  else raise exception 'Unknown action'; end if;
 end if;
 insert into baseline_private.operation_audit(actor,action,details) values(uid,action,jsonb_build_object('payload',payload,'before',oldrow));
 return jsonb_build_object('saved',true);
end $function$;


-- Called only from the existing trusted registration/claim implementations.
-- No passwords, fake auth users or shared accounts are created.
create function baseline_private.attach_member_bookings(who uuid, account_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare ev record; start_h numeric;
begin
 if not exists(select 1 from public.baseline_member_accounts where member_id=who and user_id=account_id and not disabled) then raise exception 'Member account does not match'; end if;
 if not exists(select 1 from public.baseline_rsvps where member_id=who and user_id is null) then return; end if;
 perform pg_advisory_xact_lock(2027,501);
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
revoke all on function baseline_private.attach_member_bookings(uuid,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION baseline_private.new_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare meta jsonb;n text;who uuid;
begin
 select raw_user_meta_data into meta from auth.users where id=new.id;
 if meta->>'guest_token' is not null then
 perform baseline_private.accept_guest((meta->>'guest_token')::uuid,new.id,meta,true);return new;end if;
 who:=(meta->>'roster_id')::uuid;
 if who is null or meta->>'name_confirmation' is distinct from 'true' then raise exception 'Choose your own scoreboard name and confirm it';end if;
 if new.phone is null or new.phone !~ '^\+?[0-9 ()-]{10,25}$' or length(regexp_replace(new.phone,'[^0-9]','','g')) not between 10 and 15 then raise exception 'Enter a valid mobile number';end if;
 perform pg_advisory_xact_lock(2027,501);
 select name into n from public.baseline_members where id=who and not invite_only for update;
 if n is null then raise exception 'Choose your name from the list';end if;
 if exists(select 1 from public.baseline_member_accounts where member_id=who) then raise exception 'This name already has an account';end if;
 insert into public.baseline_member_accounts(user_id,member_id) values(new.id,who);
 update public.profiles set full_name=n where id=new.id;
 perform baseline_private.attach_member_bookings(who,new.id);
 return new;
end $function$;

CREATE OR REPLACE FUNCTION baseline_private.claim_member(who uuid, mobile text, confirmed boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); n text;
begin
 if uid is null then raise exception 'Sign in first'; end if;
 if confirmed is distinct from true then raise exception 'Confirm that this is your own name'; end if;
 if mobile is null or mobile !~ '^\+?[0-9 ()-]{10,25}$' or length(regexp_replace(mobile,'[^0-9]','','g')) not between 10 and 15 then raise exception 'Enter a valid mobile number'; end if;
 if exists(select 1 from public.baseline_member_accounts where user_id=uid and (disabled or member_id is not null)) then raise exception 'Your account already has a name or needs organiser help'; end if;
 perform pg_advisory_xact_lock(2027,501);
 select name into n from public.baseline_members where id=who for update;
 if n is null then raise exception 'Choose your name from the list'; end if;
 if exists(select 1 from public.baseline_member_accounts where member_id=who) then raise exception 'This name already has an account. Sign in or contact an organiser'; end if;
 insert into public.baseline_member_accounts(user_id,member_id) values(uid,who) on conflict(user_id) do update set member_id=excluded.member_id;
 update public.profiles set full_name=n,phone=trim(mobile) where id=uid;
 perform baseline_private.attach_member_bookings(who,uid);
end $function$;

CREATE OR REPLACE FUNCTION baseline_private.release_member(who uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid; ev record;
begin
 if not public.is_admin() then raise exception 'Organiser access required'; end if;
 perform pg_advisory_xact_lock(2027,501);
 perform 1 from public.baseline_members where id=who for update;
 select user_id into uid from public.baseline_member_accounts where member_id=who for update;
 if uid is null then raise exception 'Name is not claimed'; end if;
 if exists(select 1 from public.profiles where id=uid and is_admin) then raise exception 'Organiser accounts require manual recovery'; end if;
 -- Cancel future RSVPs through the ordinary capacity/promotion transaction before blocking the account.
 for ev in select e.id from public.baseline_events e join public.baseline_rsvps r on r.event_id=e.id where r.user_id=uid and e.date>=current_date and not e.cancelled loop
  perform baseline_private.submit_rsvp(jsonb_build_object('event_id',ev.id,'user_id',uid,'attending',false));
 end loop;
 update public.baseline_rsvps set member_id=null where user_id=uid;
 update public.baseline_member_accounts set member_id=null,disabled=true where user_id=uid;
end $function$;

notify pgrst, 'reload schema';
