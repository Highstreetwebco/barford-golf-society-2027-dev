-- Invitations authorize one event booking, never an Auth account or site preview.
alter table baseline_private.guest_requests
 add column email text,
 add column agreed_price numeric,
 add column revision integer not null default 0,
 add column photo_changed_at timestamptz;
alter table public.baseline_members drop constraint baseline_members_name_key;
create unique index baseline_member_name_unique on public.baseline_members(name) where not invite_only;
-- Separate guests may have the same name. Their private invitation is the identity.
drop index if exists baseline_private.baseline_guest_once;

create or replace function baseline_private.guest_rsvp_label()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then new.guest_host_id:=old.guest_host_id; end if;
 if new.guest_host_id is not null then
  new.name:=coalesce((select full_name from public.profiles where id=new.user_id),
   (select name from baseline_private.guest_requests where member_id=new.member_id and event_id=new.event_id),
   (select name from public.baseline_members where id=new.member_id))||' (guest)';
 end if;
 return new;
end $$;

create function baseline_private.guest_booking_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.guest_host_id is not null and new.user_id is null then
  update baseline_private.guest_requests set revision=revision+1 where member_id=new.member_id and event_id=new.event_id;
 end if;
 return new;
end $$;
create trigger baseline_guest_booking_changed after update on public.baseline_rsvps
for each row execute function baseline_private.guest_booking_changed();
revoke all on function baseline_private.guest_booking_changed() from public,anon,authenticated;

-- Shared by the capability endpoint and a separately authenticated admin wrapper.
-- Neither a guest nor a browser can choose p_admin or execute this function directly.
create function baseline_private.guest_rsvp(action text,payload jsonb,p_admin boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
<<guest_rsvp>>
declare
 l baseline_private.guest_links; ev public.baseline_events; g baseline_private.guest_requests;
 r public.baseline_rsvps; previous public.baseline_rsvps; host_name text; today date:=(now() at time zone 'Europe/London')::date;
 editable boolean; wants boolean; n text; phone text; email text; h numeric; pref text; mid uuid;
 occupied integer; candidate record; result jsonb; photo text; old_photo text; own_time text; force_wait boolean;
begin
 if action not in ('view','save','photo_check','photo_save') then raise exception 'Unknown guest action'; end if;
 if action<>'view' then perform pg_advisory_xact_lock(2027,501); end if;
 select * into l from baseline_private.guest_links where token=(payload->>'token')::uuid for update;
 if l.token is null or (l.revoked and not p_admin) or l.claimed_by is not null then raise exception 'This invitation is unavailable. Please contact the member who invited you'; end if;
 if not p_admin and not exists(select 1 from public.baseline_member_accounts where user_id=l.host_id and not disabled) then
  raise exception 'This invitation is unavailable. Please contact the member who invited you';
 end if;
 select * into ev from public.baseline_events where id=l.event_id for update;
 select full_name into host_name from public.profiles where id=l.host_id;
 select * into g from baseline_private.guest_requests where link_token=l.token;
 select * into r from public.baseline_rsvps where event_id=l.event_id and member_id=g.member_id;
 select avatar_path into photo from baseline_private.member_portraits where member_id=g.member_id;
 editable:=not ev.cancelled and today<ev.date-10;
 if action<>'view' and not p_admin and not editable then
  raise exception 'Online guest changes close 10 days before the event. Ask your inviting member to contact the admins';
 end if;
 if action<>'view' and ev.cancelled then raise exception 'This event has been cancelled'; end if;
 if action='save' then
  if coalesce((payload->>'revision')::integer,-1)<>coalesce(g.revision,0) then raise exception 'This RSVP changed. Reload the invitation before saving'; end if;
  if (payload->>'host_id')::uuid is distinct from l.host_id then raise exception 'Confirm the member named on this invitation'; end if;
  if jsonb_typeof(payload->'attending') is distinct from 'boolean' then raise exception 'Choose your RSVP'; end if;
  wants:=(payload->>'attending')::boolean;
  force_wait:=p_admin and coalesce((payload->>'reserve')::boolean,false) and wants;
  if wants and not p_admin and not exists(select 1 from public.baseline_rsvps where event_id=l.event_id and user_id=l.host_id and attending and not reserve) then
   raise exception 'Your inviting member needs a confirmed place first. Please contact them';
  end if;
  if ev.event_type<>'social' and wants and (r.id is null or not(r.attending or r.reserve)) and (select count(*) from public.baseline_rsvps x where x.event_id=ev.id and x.guest_host_id=l.host_id and (x.attending or x.reserve) and x.id is distinct from r.id)>=3 then raise exception 'Your inviting member already has three guest places. Ask them to contact the admins'; end if;
  if g.id is null and not wants then raise exception 'Choose Join event to save a new RSVP'; end if;
  if wants and not p_admin and (r.id is null or not(r.attending or r.reserve)) and ev.rsvp_deadline is not null and today>ev.rsvp_deadline then raise exception 'Bookings have closed. Ask your inviting member to contact the admins'; end if;
  if g.id is null and (payload->>'guest_price')::numeric is distinct from ev.guest_price then raise exception 'The guest price changed. Reload the invitation'; end if;
  if wants and not p_admin and coalesce(ev.cancellation_terms,'')<>'' and
   (payload->>'accept_terms' is distinct from 'true' or payload->>'terms_snapshot' is distinct from ev.cancellation_terms) then
   raise exception 'Read and accept the current cancellation terms';
  end if;
  n:=trim(coalesce(payload->>'full_name','')); phone:=trim(coalesce(payload->>'phone','')); email:=nullif(lower(trim(payload->>'email')),'');
  if length(n) not between 2 and 150 or n ~ '[[:cntrl:]]' then raise exception 'Enter your full name'; end if;
  if phone !~ '^\+?[0-9 ()-]{10,25}$' or length(regexp_replace(guest_rsvp.phone,'[^0-9]','','g')) not between 10 and 15 then raise exception 'Enter a valid contact number'; end if;
  if email is not null and (length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Enter a valid email address or leave it blank'; end if;
  h:=nullif(payload->>'guest_handicap','')::numeric;
  if ev.event_type<>'social' and (h is null or h::text in ('NaN','Infinity','-Infinity') or h<0 or h>54 or round(h,1)<>h) then raise exception 'Enter a handicap from 0 to 54, with at most one decimal place'; end if;
  if ev.event_type='social' then h:=null; end if;
  pref:=nullif(payload->>'preferred_time','');
  if pref is not null and pref not in ('First','Middle','End') then raise exception 'Choose a valid tee preference'; end if;
  if exists(select 1 from baseline_private.guest_requests x where x.event_id=l.event_id and x.id is distinct from g.id and regexp_replace(x.phone,'[^0-9]','','g')=regexp_replace(guest_rsvp.phone,'[^0-9]','','g')) or
   exists(select 1 from public.baseline_rsvps x join public.profiles p on p.id=x.user_id where x.event_id=l.event_id and regexp_replace(p.phone,'[^0-9]','','g')=regexp_replace(guest_rsvp.phone,'[^0-9]','','g')) then
   raise exception 'A booking already uses these contact details. Use the original link or contact your inviting member';
  end if;
  previous:=r;
  if g.id is null then
   insert into public.baseline_members(name,invite_only) values(n,true) returning id into mid;
   insert into baseline_private.guest_requests(host_id,event_id,name,phone,email,requested_handicap,status,member_id,link_token,agreed_price)
   values(l.host_id,l.event_id,n,phone,email,h,case when h is null then 'approved' else 'pending' end,mid,l.token,ev.guest_price) returning * into g;
   insert into public.baseline_rsvps(event_id,member_id,name,guest_host_id,attending,reserve)
   values(l.event_id,mid,n||' (guest)',l.host_id,false,true) returning * into r;
  else
   update baseline_private.guest_requests set name=n,phone=guest_rsvp.phone,email=guest_rsvp.email,requested_handicap=h,
    status=case when requested_handicap is distinct from h and h is not null then 'pending' else status end,revision=revision+1 where id=g.id;
   update public.baseline_members set name=n where id=g.member_id;
  end if;
  insert into baseline_private.member_contacts(member_id,phone) values(g.member_id,phone)
   on conflict(member_id) do update set phone=excluded.phone,updated_at=now();
  insert into public.baseline_rsvp_contacts(rsvp_id,phone) values(r.id,phone) on conflict(rsvp_id) do update set phone=excluded.phone;
  update public.baseline_rsvps set name=n||' (guest)',
   attending=wants and r.attending and not force_wait,reserve=wants and(not r.attending or r.reserve or force_wait),
   buggy=wants and ev.event_type<>'social' and coalesce((payload->>'buggy')::boolean,false),
   preferred_time=case when wants and ev.event_type<>'social' then pref end,
   requested_at=case when r.attending or r.reserve then r.requested_at else now() end,updated_at=now(),
   terms_accepted_at=case when wants and (p_admin or payload->>'accept_terms'='true') then now() else terms_accepted_at end,
   terms_snapshot=case when wants then ev.cancellation_terms else terms_snapshot end where id=r.id;
  select count(*) into occupied from public.baseline_rsvps where event_id=ev.id and attending and not reserve;
  for candidate in select id from public.baseline_rsvps where event_id=ev.id and reserve and(not force_wait or id<>r.id) order by requested_at,id loop
   exit when ev.max_players is not null and occupied>=ev.max_players;
   update public.baseline_rsvps set attending=true,reserve=false,updated_at=now() where id=candidate.id; occupied:=occupied+1;
  end loop;
  select * into r from public.baseline_rsvps where id=r.id;
  if ev.tee_published_at is not null and (previous.id is null or previous.attending is distinct from r.attending or previous.reserve is distinct from r.reserve or previous.buggy is distinct from r.buggy or previous.name is distinct from r.name or previous.preferred_time is distinct from r.preferred_time or g.requested_handicap is distinct from h) then
   update public.baseline_events set tee_times_dirty=true where id=ev.id; ev.tee_times_dirty:=true;
  end if;
  if p_admin then
   insert into baseline_private.operation_audit(actor,action,details) values(auth.uid(),'admin_guest_rsvp',jsonb_build_object('event_id',ev.id,'member_id',g.member_id,'before',to_jsonb(previous),'attending',wants));
  end if;
 elsif action in ('photo_check','photo_save') then
  if g.id is null then raise exception 'Save your RSVP before adding a photo'; end if;
  if action='photo_save' then
   old_photo:=photo; photo:=nullif(payload->>'photo_path','');
   if old_photo is distinct from nullif(payload->>'expected_path','') then raise exception 'The photo changed. Reload before saving'; end if;
   if photo is not null and (photo !~ ('^'||g.member_id::text||'/[a-f0-9-]{36}\.jpg$') or not exists(select 1 from storage.objects where bucket_id='baseline-profile-images' and name=photo)) then raise exception 'Upload a valid guest photo first'; end if;
   if photo is null then delete from baseline_private.member_portraits where member_id=g.member_id;
   else insert into baseline_private.member_portraits(member_id,avatar_path) values(g.member_id,photo)
    on conflict(member_id) do update set avatar_path=excluded.avatar_path,updated_at=now(); end if;
   update baseline_private.guest_requests set photo_changed_at=now() where id=g.id;
  end if;
 end if;
 select * into g from baseline_private.guest_requests where link_token=l.token;
 select * into r from public.baseline_rsvps where event_id=l.event_id and member_id=g.member_id;
 if ev.tee_published_at is not null and not ev.tee_times_dirty and r.attending and not r.reserve then
  select tee_time into own_time from public.baseline_tee_times t where t.event_id=ev.id and exists(select 1 from jsonb_array_elements(t.players) p where coalesce(p->>'participant_id',p->>'user_id')=r.participant_id::text);
 end if;
 return jsonb_build_object('status',case when g.id is null then 'open' else 'joined' end,'event_id',ev.id,'event_name',ev.name,'date',ev.date,'first_time',ev.first_time,
  'location',ev.location,'address',ev.address,'event_type',ev.event_type,'cancelled',ev.cancelled,'host_id',l.host_id,'host_name',host_name,
  'guest_price',case when g.id is null then ev.guest_price else g.agreed_price end,'payment_due',ev.payment_due,'cancellation_terms',ev.cancellation_terms,
  'editable',editable or p_admin,'cutoff_date',ev.date-10,'booking_open',editable and(ev.rsvp_deadline is null or today<=ev.rsvp_deadline),
  'waiting',ev.max_players is not null and(select count(*) from public.baseline_rsvps where event_id=ev.id and attending and not reserve)>=ev.max_players,
  'revision',coalesce(g.revision,0),'member_id',g.member_id,'full_name',g.name,'phone',g.phone,'email',g.email,'guest_handicap',g.requested_handicap,'handicap_status',g.status,
  'attending',coalesce(r.attending,false),'reserve',coalesce(r.reserve,false),'buggy',coalesce(r.buggy,false),'preferred_time',r.preferred_time,
  'avatar_path',photo,'previous_path',old_photo,'tee_time',own_time,'round_hours',ev.round_hours);
end $$;
revoke all on function baseline_private.guest_rsvp(text,jsonb,boolean) from public,anon,authenticated;
grant execute on function baseline_private.guest_rsvp(text,jsonb,boolean) to service_role;
create function public.baseline_guest_rsvp(action text,payload jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select baseline_private.guest_rsvp(action,payload,false);$$;
revoke all on function public.baseline_guest_rsvp(text,jsonb) from public,anon,authenticated;
grant execute on function public.baseline_guest_rsvp(text,jsonb) to service_role;

create function baseline_private.admin_guest_rsvp(action text,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare token uuid;
begin
 if auth.uid() is null or not public.is_admin() or not baseline_private.active_member() then raise exception 'Organiser access required'; end if;
 select g.link_token into token from baseline_private.guest_requests g where g.member_id=(payload->>'member_id')::uuid and g.event_id=(payload->>'event_id')::bigint and g.user_id is null;
 if token is null then raise exception 'Guest booking not found'; end if;
 return baseline_private.guest_rsvp(action,payload||jsonb_build_object('token',token),true);
end $$;
create function public.baseline_admin_guest_rsvp(action text,payload jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select baseline_private.admin_guest_rsvp(action,payload);$$;
revoke all on function baseline_private.admin_guest_rsvp(text,jsonb),public.baseline_admin_guest_rsvp(text,jsonb) from public,anon;
grant execute on function baseline_private.admin_guest_rsvp(text,jsonb),public.baseline_admin_guest_rsvp(text,jsonb) to authenticated;

-- Existing bookings show their agreed charge if the advertised event rate changes.
create or replace function baseline_private.guest_invitations(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();l baseline_private.guest_links;ev public.baseline_events;g baseline_private.guest_requests;h numeric;result jsonb;
begin
 if action='view' then
 select * into l from baseline_private.guest_links where token=(payload->>'token')::uuid;
 if l.token is null or l.revoked then return jsonb_build_object('status','unavailable');end if;
 select * into ev from public.baseline_events where id=l.event_id;
 if ev.cancelled or ev.date<(now() at time zone 'Europe/London')::date or (ev.rsvp_deadline is not null and ev.rsvp_deadline<(now() at time zone 'Europe/London')::date) or not exists(select 1 from public.baseline_member_accounts where user_id=l.host_id and not disabled) then return jsonb_build_object('status','closed');end if;
 if l.claimed_by is not null and l.claimed_by is distinct from uid then return jsonb_build_object('status','used');end if;
 return jsonb_build_object('status',case when l.claimed_by=uid then 'joined' else 'open' end,'event_id',ev.id,'event_name',ev.name,'date',ev.date,'first_time',ev.first_time,'location',ev.location,'event_type',ev.event_type,'host_name',(select full_name from public.profiles where id=l.host_id),'guest_price',ev.guest_price,'payment_due',ev.payment_due,'cancellation_terms',ev.cancellation_terms,'rsvp_deadline',ev.rsvp_deadline,'waiting',ev.max_players is not null and (select count(*) from public.baseline_rsvps where event_id=ev.id and attending and not reserve)>=ev.max_players);
 end if;
 if not baseline_private.active_member() then raise exception 'Sign in with your active account';end if;
 if action='create' then
 if coalesce((select category from baseline_private.member_types where user_id=uid),'member')='guest' and not public.is_admin() then raise exception 'A society member must invite guests';end if;
 select * into ev from public.baseline_events where id=(payload->>'event_id')::bigint for update;
 if ev.id is null or ev.cancelled or ev.date<(now() at time zone 'Europe/London')::date or (ev.rsvp_deadline is not null and ev.rsvp_deadline<(now() at time zone 'Europe/London')::date) then raise exception 'Bookings for this round are closed';end if;
 if ev.date-10<=(now() at time zone 'Europe/London')::date then raise exception 'Guest invitations close 10 days before the event. Contact the admins'; end if;
 if not exists(select 1 from public.baseline_rsvps where event_id=ev.id and user_id=uid and attending and not reserve) then raise exception 'RSVP and confirm your own place before inviting a guest'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,2028));
 if (select count(*) from baseline_private.guest_links where host_id=uid and created_at>now()-interval '1 day')>=10 then raise exception 'You have created ten invitations today. Reuse an unused invite or contact an organiser';end if;
 if ev.event_type<>'social' and (select count(*) from baseline_private.guest_links lk left join baseline_private.guest_requests gr on gr.link_token=lk.token left join public.baseline_rsvps r on r.member_id=gr.member_id and r.event_id=lk.event_id where lk.host_id=uid and lk.event_id=ev.id and not lk.revoked and (gr.id is null or r.attending or r.reserve))>=3 then raise exception 'A fourball can include you and three guests. Reuse an unused invitation or contact the admins'; end if;
 insert into baseline_private.guest_links(host_id,event_id) values(uid,ev.id) returning * into l;
 return jsonb_build_object('token',l.token,'event_id',ev.id,'host_name',(select full_name from public.profiles where id=uid));
 elsif action='join' then raise exception 'Open the guest invitation link to RSVP without an account';
 elsif action='mine' then
 return jsonb_build_object('category',coalesce((select category from baseline_private.member_types where user_id=uid),'member'),'links',coalesce((select jsonb_agg(jsonb_build_object('token',lk.token,'claimed',lk.claimed_by is not null or gr.id is not null,'revoked',lk.revoked,'guest_name',coalesce(gr.name,p.full_name),'event_id',lk.event_id,'attending',r.attending,'reserve',r.reserve) order by lk.created_at desc) from baseline_private.guest_links lk left join public.profiles p on p.id=lk.claimed_by left join baseline_private.guest_requests gr on gr.link_token=lk.token left join public.baseline_rsvps r on r.member_id=gr.member_id and r.event_id=lk.event_id where lk.host_id=uid and lk.event_id=(payload->>'event_id')::bigint),'[]'::jsonb),'bookings',coalesce((select jsonb_agg(jsonb_build_object('event_id',r.event_id,'host_name',p.full_name,'status',gr.status,'requested_handicap',gr.requested_handicap,'guest_price',coalesce((select c.amount from baseline_private.charges c where c.user_id=r.user_id and c.event_id=r.event_id),er.guest_price),'reserve',r.reserve,'attending',r.attending,'event_name',er.name,'date',er.date) order by er.date,er.id) from public.baseline_rsvps r join public.baseline_events er on er.id=r.event_id join public.profiles p on p.id=r.guest_host_id left join baseline_private.guest_requests gr on gr.event_id=r.event_id and gr.user_id=r.user_id where r.user_id=uid and er.date>=(now() at time zone 'Europe/London')::date and not er.cancelled),'[]'::jsonb));
 elsif action='revoke' then
 update baseline_private.guest_links set revoked=true where token=(payload->>'token')::uuid and (host_id=uid or public.is_admin()) and claimed_by is null and not exists(select 1 from baseline_private.guest_requests gr where gr.link_token=guest_links.token);
 if not found then raise exception 'Only an unused invitation can be cancelled';end if;return '{}'::jsonb;
 elsif action='review' then
 if not public.is_admin() then raise exception 'Organiser access required';end if;
 select * into g from baseline_private.guest_requests where id=(payload->>'id')::uuid and link_token is not null for update;
 if g.id is null or g.status<>'pending' then raise exception 'This handicap request is already reviewed';end if;
 h:=(payload->>'handicap')::numeric;
 if h is null or h::text in ('NaN','Infinity','-Infinity') or h<0 or h>36 or round(h,1)<>h then raise exception 'Approve a society starting handicap from 0 to 36';end if;
 update public.profiles set handicap=h where id=g.user_id and handicap is null;
 if g.user_id is null then update public.baseline_members set starting_handicap=h where id=g.member_id; end if;
 update baseline_private.guest_requests set status='approved',approved_handicap=case when g.user_id is null then h else (select handicap from public.profiles where id=g.user_id) end,revision=revision+1 where id=g.id;
 insert into baseline_private.operation_audit(actor,action,details) values(uid,'approve_guest_handicap',jsonb_build_object('id',g.id,'handicap',h));return '{}'::jsonb;
 else raise exception 'Unknown invitation action';end if;
end $$;

-- Stop new guest invitations from creating synthetic login accounts through old clients.
create or replace function baseline_private.accept_guest(invite uuid,who uuid,payload jsonb,creating boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$ begin raise exception 'Open the guest invitation link to RSVP without an account'; end $$;

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
 if exists(select 1 from public.baseline_rsvps guest where guest.event_id=event and guest.attending and not guest.reserve and guest.guest_host_id is not null and not exists(
  select 1 from public.baseline_tee_times t where t.event_id=event
  and exists(select 1 from jsonb_array_elements(t.players) p where coalesce(p->>'participant_id',p->>'user_id')=guest.participant_id::text)
  and exists(select 1 from jsonb_array_elements(t.players) p where coalesce(p->>'participant_id',p->>'user_id')=guest.guest_host_id::text)
 )) then raise exception 'Keep every guest with their inviting member. Confirm the host is playing and put them in the same group'; end if;
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


create or replace function baseline_private.admin_member_photo(target uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare account_id uuid; path text;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 if not exists(select 1 from public.baseline_members where id=target) then raise exception 'Member not found'; end if;
 if exists(select 1 from public.baseline_member_accounts where member_id=target and disabled) then raise exception 'Active member required'; end if;
 select user_id into account_id from public.baseline_member_accounts where member_id=target and not disabled;
 if account_id is null then
  select avatar_path into path from baseline_private.member_portraits where member_id=target;
 else
  select baseline_avatar_path into path from public.profiles where id=account_id;
 end if;
 return jsonb_build_object('avatar_path',path,'upload_folder',coalesce(account_id,target));
end $$;

 drop policy "Admins upload roster portraits" on storage.objects;
 drop policy "Admins delete roster portraits" on storage.objects;
 create policy "Admins upload roster portraits" on storage.objects for insert to authenticated
 with check(bucket_id='baseline-profile-images' and (select public.is_admin()) and exists(
 select 1 from public.baseline_members m where m.id::text=(storage.foldername(storage.objects.name))[1]
 and not exists(select 1 from public.baseline_member_accounts a where a.member_id=m.id and a.disabled)));
 create policy "Admins delete roster portraits" on storage.objects for delete to authenticated
 using(bucket_id='baseline-profile-images' and (select public.is_admin()) and exists(
 select 1 from public.baseline_members m where m.id::text=(storage.foldername(storage.objects.name))[1]
 and not exists(select 1 from public.baseline_member_accounts a where a.member_id=m.id and a.disabled)));
 notify pgrst,'reload schema';
-- Service-role-only entry point used by the invitation Edge Function.
grant usage on schema baseline_private to service_role;
