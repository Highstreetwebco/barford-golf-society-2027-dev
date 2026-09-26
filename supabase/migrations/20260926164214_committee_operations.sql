
-- Isolated 2027 committee operations. All personal finance and decisions stay private.
create table baseline_private.handicap_overrides (
 user_id uuid references public.profiles(id), round_number integer check(round_number between 2 and 7),
 handicap numeric not null check(handicap>=0 and handicap<=100 and round(handicap,1)=handicap),
 reason text not null check(length(trim(reason)) between 5 and 1000),actor uuid not null,created_at timestamptz not null default now(),
 primary key(user_id,round_number)
);
alter table baseline_private.handicap_overrides enable row level security;
revoke all on baseline_private.handicap_overrides from public,anon,authenticated;
create function baseline_private.handicap_at(who uuid, target_round integer) returns numeric language plpgsql stable security definer set search_path='' as $$
declare h numeric; previous integer:=0; v numeric;
begin
 select handicap into h from public.profiles where id=who;
 select r.round_number,(x->>'next_handicap')::numeric into previous,v from baseline_private.league_rounds r cross join lateral jsonb_array_elements(r.results) x
 where r.published_entries is not null and r.round_number<target_round and x->>'user_id'=who::text order by r.round_number desc limit 1;
 if found then h:=v; end if;
 select handicap into v from baseline_private.handicap_overrides where user_id=who and round_number>coalesce(previous,0) and round_number<=target_round order by round_number desc limit 1;
 if found then h:=v; end if;
 return h;
end $$;
revoke all on function baseline_private.handicap_at(uuid,integer) from public,anon,authenticated;
create or replace function baseline_private.league_rebuild() returns void language plpgsql security definer set search_path='' as $$
declare rr record; pp record; running jsonb:='{}'; out_rows jsonb; h numeric; pts integer; adjustment integer; av integer; n integer;
begin
 for rr in select * from baseline_private.league_rounds where published_entries is not null order by round_number loop
  select count(*) into n from jsonb_array_elements(rr.published_entries) x where (x->>'points')::integer>0;
  select floor(avg(points)+0.5)::integer into av from (
   select (x->>'points')::integer points,row_number() over(order by (x->>'points')::integer) pos
   from jsonb_array_elements(rr.published_entries) x where (x->>'points')::integer>0
  ) t where n<=4 or (pos>1 and pos<n);
  out_rows:='[]';
  for pp in select p.id,p.handicap from public.profiles p join public.baseline_member_accounts a on a.user_id=p.id where not a.disabled order by p.id loop
   h:=coalesce((select handicap from baseline_private.handicap_overrides where user_id=pp.id and round_number=rr.round_number),(running->>pp.id::text)::numeric,pp.handicap);
   select (x->>'points')::integer into pts from jsonb_array_elements(rr.published_entries) x where x->>'user_id'=pp.id::text;
   if pts is not null and h is null then raise exception 'Set the starting handicap for every player with a score'; end if;
   adjustment:=case when pts is null then 0 else baseline_private.league_adjustment(pts,av,h) end;
   out_rows:=out_rows||jsonb_build_array(jsonb_build_object('user_id',pp.id,'handicap',h,'points',pts,'adjustment',case when pts is null then null else adjustment end,'next_handicap',case when h is null then null else greatest(0,h+adjustment) end,'winner',coalesce(pp.id=rr.winner,false)));
   if h is not null then running:=jsonb_set(running,array[pp.id::text],to_jsonb(greatest(0,h+adjustment))); end if;
  end loop;
  update baseline_private.league_rounds set average=av,results=out_rows where event_id=rr.event_id;
 end loop;
end $$;
create or replace function baseline_private.league_admin() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 return jsonb_build_object('revision',(select revision from baseline_private.league_state),'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'starting_handicap',p.handicap,'adjustments',coalesce((select jsonb_agg(to_jsonb(o) order by round_number) from baseline_private.handicap_overrides o where o.user_id=p.id),'[]'::jsonb)) order by lower(p.full_name)) from public.profiles p join public.baseline_member_accounts a on a.user_id=p.id where not a.disabled),'[]'::jsonb),'rounds',coalesce((select jsonb_agg(to_jsonb(r) order by round_number) from baseline_private.league_rounds r),'[]'::jsonb));
end $$;
create or replace function baseline_private.league_handicap_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.handicap is distinct from new.handicap then
  if new.handicap is not null and (new.handicap::text in ('NaN','Infinity','-Infinity') or new.handicap<0 or new.handicap>36 or round(new.handicap,1)<>new.handicap) then raise exception 'Starting handicap must be 0 to 36, with at most one decimal place'; end if;
  perform pg_advisory_xact_lock(2027,501);
  if new.handicap is null and exists(select 1 from baseline_private.league_rounds r,jsonb_array_elements(r.published_entries) x where x->>'user_id'=new.id::text and x->>'points' is not null) then raise exception 'A player with published scores needs a starting handicap'; end if;
 end if;
 return new;
end $$;

create function baseline_private.manual_handicap(who uuid,from_round integer,new_handicap numeric,reason text,expected_revision integer,remove boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare old_h numeric; prior jsonb;
begin
 if not baseline_private.active_member() or not public.is_admin() then raise exception 'Organiser access required'; end if;
 perform pg_advisory_xact_lock(2027,501);
 if expected_revision is distinct from (select revision from baseline_private.league_state) then raise exception 'Scores or handicaps changed. Reload before saving'; end if;
 if from_round is null or from_round not between 2 and 7 then raise exception 'Choose round 2 to 7'; end if;
 if exists(select 1 from baseline_private.league_rounds where published_entries is not null and round_number>=from_round) then raise exception 'Choose an unpublished future round. Earlier results cannot be changed here'; end if;
 if not exists(select 1 from public.baseline_member_accounts where user_id=who and not disabled) then raise exception 'Choose a registered member'; end if;
 if reason is null or length(trim(reason)) not between 5 and 1000 then raise exception 'Record the committee decision (5 to 1000 characters)'; end if;
 if not remove and (new_handicap is null or new_handicap::text in ('NaN','Infinity','-Infinity') or new_handicap<0 or new_handicap>100 or round(new_handicap,1)<>new_handicap) then raise exception 'Enter a handicap from 0 to 100, with at most one decimal place'; end if;
 old_h:=baseline_private.handicap_at(who,from_round);
 if old_h is null then raise exception 'Set this player’s starting handicap first'; end if;
 select to_jsonb(o) into prior from baseline_private.handicap_overrides o where user_id=who and round_number=from_round;
 if remove then delete from baseline_private.handicap_overrides where user_id=who and round_number=from_round;
 else insert into baseline_private.handicap_overrides values(who,from_round,new_handicap,trim(reason),auth.uid(),now()) on conflict(user_id,round_number) do update set handicap=excluded.handicap,reason=excluded.reason,actor=excluded.actor,created_at=now(); end if;
 update baseline_private.league_state set revision=revision+1;
 insert into baseline_private.league_audit(actor,action,details) values(auth.uid(),'manual_handicap',jsonb_build_object('user_id',who,'from_round',from_round,'before',old_h,'after',case when remove then baseline_private.handicap_at(who,from_round) else new_handicap end,'reason',reason,'removed',remove,'previous_override',prior));
 return baseline_private.league_admin();
end $$;
create function public.baseline_manual_handicap(who uuid,from_round integer,new_handicap numeric,reason text,expected_revision integer,remove boolean default false) returns jsonb language sql security invoker set search_path='' as $$select baseline_private.manual_handicap(who,from_round,new_handicap,reason,expected_revision,remove);$$;
revoke all on function baseline_private.manual_handicap(uuid,integer,numeric,text,integer,boolean),public.baseline_manual_handicap(uuid,integer,numeric,text,integer,boolean) from public,anon,authenticated;
grant execute on function baseline_private.manual_handicap(uuid,integer,numeric,text,integer,boolean),public.baseline_manual_handicap(uuid,integer,numeric,text,integer,boolean) to authenticated;

alter table public.baseline_events
 add column event_type text not null default 'league' check(event_type in ('league','pairs','social')),
 add column arrival_time text, add column refreshment_time text, add column included text,add column parking text,add column practice text,add column course_layout text,add column event_notice text,add column format_rules text,add column course_phone text,
 add column member_price numeric(10,2) check(member_price>=0),add column course_member_price numeric(10,2) check(course_member_price>=0),
 add column rsvp_deadline date,add column payment_due date,add column cancellation_deadline date,add column cancellation_terms text,
 add column tee_interval integer not null default 8 check(tee_interval between 1 and 60),
 add column committed_places integer not null default 0 check(committed_places>=0),
 add column tee_revision integer not null default 0,add column tee_published_at timestamptz;
alter table public.baseline_events add constraint baseline_type_round check(event_type='league' or round_number is null);
alter table public.baseline_rsvps add column terms_accepted_at timestamptz, add column terms_snapshot text;
alter table public.baseline_buggy_pairs add column confirmed_at timestamptz;
create table baseline_private.operations_settings(id boolean primary key default true check(id),bank_instructions text not null default '',membership_fee numeric(10,2) check(membership_fee>=0),membership_due date,guest_policy text not null default 'Guest handicaps must be approved individually by an organiser before play.');
insert into baseline_private.operations_settings default values;
create table baseline_private.member_types(user_id uuid primary key references public.profiles(id),category text not null default 'member' check(category in ('member','guest')));
create table baseline_private.charges(id bigint generated always as identity primary key,user_id uuid not null references public.profiles(id),event_id bigint references public.baseline_events(id),scope text not null,label text not null,category text not null default 'member',amount numeric(10,2) not null check(amount>=0),received numeric(10,2) not null default 0 check(received>=0),reported boolean not null default false,due_date date,cancellation_review boolean not null default false,note text not null default '',revision integer not null default 0,updated_at timestamptz not null default now(),unique(user_id,scope));
create index baseline_charges_event on baseline_private.charges(event_id);
create table baseline_private.operation_audit(id bigint generated always as identity primary key,actor uuid,action text,details jsonb,created_at timestamptz default now());
create table baseline_private.guest_requests(id uuid primary key default gen_random_uuid(),host_id uuid references public.profiles(id),event_id bigint references public.baseline_events(id),name text not null check(length(trim(name)) between 2 and 150),phone text not null check(length(phone) between 10 and 25),requested_handicap numeric,approved_handicap numeric,status text not null default 'pending' check(status in ('pending','approved','rejected')),member_id uuid references public.baseline_members(id),created_at timestamptz default now());
create index baseline_guest_host on baseline_private.guest_requests(host_id);
create index baseline_guest_event on baseline_private.guest_requests(event_id);
create index baseline_guest_member on baseline_private.guest_requests(member_id);
create table baseline_private.playing_pairs(id bigint generated always as identity primary key,event_id bigint not null references public.baseline_events(id),first_user uuid not null references public.profiles(id),second_user uuid references public.profiles(id),status text not null check(status in ('looking','requested','confirmed')),updated_at timestamptz not null default now(),check(first_user is distinct from second_user));
create index baseline_pairs_event on baseline_private.playing_pairs(event_id);
create table baseline_private.event_tasks(event_id bigint references public.baseline_events(id),task text,owner text not null default '',done boolean not null default false,updated_at timestamptz default now(),primary key(event_id,task));
create table baseline_private.committee_items(id bigint generated always as identity primary key,kind text not null check(kind in ('expense','prize')),description text not null check(length(trim(description)) between 2 and 300),owner text not null default '',amount numeric(10,2) not null default 0 check(amount>=0),quantity integer not null default 1 check(quantity>=0),done boolean not null default false,note text not null default '',revision integer not null default 0,updated_at timestamptz default now());
create table baseline_private.tee_changes(id bigint generated always as identity primary key,event_id bigint not null references public.baseline_events(id),user_id uuid not null references public.profiles(id),old_time text,new_time text,revision integer,seen boolean not null default false,created_at timestamptz default now());
create index baseline_tee_changes_member on baseline_private.tee_changes(user_id,event_id);
do $$declare t text;begin
 foreach t in array array['operations_settings','member_types','charges','operation_audit','guest_requests','playing_pairs','event_tasks','committee_items','tee_changes'] loop
 execute format('alter table baseline_private.%I enable row level security',t);
 execute format('revoke all on baseline_private.%I from public,anon,authenticated',t);
 end loop;
end $$;
create function baseline_private.sync_charge() returns trigger language plpgsql security definer set search_path='' as $$
declare ev public.baseline_events; cat text; cost numeric;
begin
 select * into ev from public.baseline_events where id=new.event_id;
 cat:=coalesce((select category from baseline_private.member_types where user_id=new.user_id),'member');
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
end $$;
create trigger baseline_sync_charge after insert or update of attending,reserve on public.baseline_rsvps for each row execute function baseline_private.sync_charge();
revoke all on function baseline_private.sync_charge() from public,anon,authenticated;
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
 select * into person from public.profiles where id=member;
 if person.id is null or length(trim(person.full_name)) not between 1 and 150 then raise exception 'Add your name in My account first'; end if;
 if jsonb_typeof(payload->'attending') is distinct from 'boolean' then raise exception 'Choose whether you are playing'; end if;
 wants:=(payload->>'attending')::boolean;
 if wants and not public.is_admin() and ev.rsvp_deadline is not null and (now() at time zone 'Europe/London')::date>ev.rsvp_deadline and not exists(select 1 from public.baseline_rsvps where event_id=ev.id and user_id=member and (attending or reserve)) then raise exception 'The RSVP deadline has passed. Contact an organiser'; end if;
 if wants and not public.is_admin() and length(coalesce(ev.cancellation_terms,''))>0 and payload->>'accept_terms' is distinct from 'true' and not exists(select 1 from public.baseline_rsvps where event_id=ev.id and user_id=member and (attending or reserve) and terms_snapshot=ev.cancellation_terms) then raise exception 'Accept the cancellation terms before booking'; end if;
 needs_buggy:=ev.event_type<>'social' and wants and coalesce((payload->>'buggy')::boolean,false);
 pref:=case when wants and ev.event_type<>'social' then payload->>'preferred_time' else null end;
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
create or replace function baseline_private.save_tee_times(event bigint,groups jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare g jsonb; player jsonb; roster jsonb; r public.baseline_rsvps; seen uuid[]:='{}'; n integer:=0; uid uuid; previous jsonb; changed record;
begin
 if not public.is_admin() then raise exception 'Organiser access required'; end if;
 perform 1 from public.baseline_events where id=event for update;
 if not found then raise exception 'Event not found'; end if;
 if jsonb_typeof(groups) is distinct from 'array' then raise exception 'Invalid tee groups'; end if;
 if exists(select 1 from public.baseline_events where id=event and (event_type='social' or cancelled)) then raise exception 'Tee groups are only available for active golf events'; end if;
 select coalesce(jsonb_object_agg(p->>'user_id',jsonb_build_object('time',t.tee_time,'group',t.group_number,'players',t.players)),'{}') into previous from public.baseline_tee_times t cross join lateral jsonb_array_elements(t.players) p where t.event_id=event;
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
 if exists(select 1 from baseline_private.playing_pairs p where p.event_id=event and p.status='confirmed' and not exists(select 1 from public.baseline_tee_times t where t.event_id=event and t.players @> jsonb_build_array(jsonb_build_object('user_id',p.first_user),jsonb_build_object('user_id',p.second_user)))) then raise exception 'Keep confirmed playing partners in the same tee group'; end if;
 update public.baseline_events set tee_revision=tee_revision+1,tee_published_at=now() where id=event;
 for changed in select (p->>'user_id')::uuid uid,t.tee_time,t.group_number,t.players from public.baseline_tee_times t cross join lateral jsonb_array_elements(t.players) p where t.event_id=event loop
 if previous ? changed.uid::text and previous->changed.uid::text is distinct from jsonb_build_object('time',changed.tee_time,'group',changed.group_number,'players',changed.players) then
 insert into baseline_private.tee_changes(event_id,user_id,old_time,new_time,revision) values(event,changed.uid,previous->changed.uid::text->>'time',changed.tee_time,(select tee_revision from public.baseline_events where id=event)); end if;
 end loop;
 -- Pair buggy players within their published group. Preserve a booking owner only when the same pair remains.
 with numbered as (
 select t.group_number,(p.value->>'user_id')::uuid as uid,row_number() over(partition by t.group_number order by p.ordinality) as rn
 from public.baseline_tee_times t cross join lateral jsonb_array_elements(t.players) with ordinality p(value,ordinality)
 where t.event_id=event and p.value->>'type'='buggy'
 ), pairs as (select least(a.uid,b.uid) u1,greatest(a.uid,b.uid) u2 from numbered a join numbered b on b.group_number=a.group_number and b.rn=a.rn+1 where a.rn%2=1)
 delete from public.baseline_buggy_pairs bp where bp.event_id=event and not exists(select 1 from pairs p where p.u1=bp.first_user and p.u2=bp.second_user);
 with numbered as (
 select t.group_number,(p.value->>'user_id')::uuid as uid,row_number() over(partition by t.group_number order by p.ordinality) as rn
 from public.baseline_tee_times t cross join lateral jsonb_array_elements(t.players) with ordinality p(value,ordinality)
 where t.event_id=event and p.value->>'type'='buggy'
 ) insert into public.baseline_buggy_pairs(event_id,first_user,second_user)
 select event,least(a.uid,b.uid),greatest(a.uid,b.uid) from numbered a join numbered b on b.group_number=a.group_number and b.rn=a.rn+1 where a.rn%2=1 on conflict(event_id,first_user,second_user) do nothing;
 update public.baseline_events set tee_times_dirty=false where id=event;
end $$;
create or replace function baseline_private.buggy_details(event bigint, claim boolean default false, release boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); pair public.baseline_buggy_pairs; partner public.profiles; ev public.baseline_events;
begin
 if uid is null then raise exception 'Sign in first'; end if;
 if exists(select 1 from public.baseline_member_accounts where user_id=uid and disabled) then raise exception 'Contact an organiser about your account'; end if;
 select * into ev from public.baseline_events where id=event for update;
 if ev.id is null or ev.cancelled or ev.tee_times_dirty then return jsonb_build_object('status','pending'); end if;
 select * into pair from public.baseline_buggy_pairs where event_id=event and uid in (first_user,second_user) for update;
 if pair.id is null then return jsonb_build_object('status','unpaired'); end if;
 if (select count(*) from public.baseline_rsvps where event_id=event and user_id in(pair.first_user,pair.second_user) and attending and not reserve and buggy)<>2 then return jsonb_build_object('status','pending'); end if;
 if (claim or release) and ev.date<current_date then raise exception 'This event has finished'; end if;
 if claim then
  if pair.booking_user is not null and pair.booking_user<>uid then raise exception 'Your partner is already booking the buggy. Contact them before changing this'; end if;
  update public.baseline_buggy_pairs set booking_user=uid,updated_at=now() where id=pair.id returning * into pair;
 elsif release then
  if pair.booking_user is distinct from uid then raise exception 'Only the person booking can release this'; end if;
  update public.baseline_buggy_pairs set booking_user=null,confirmed_at=null,updated_at=now() where id=pair.id returning * into pair;
 end if;
 select * into partner from public.profiles where id=case when pair.first_user=uid then pair.second_user else pair.first_user end;
 return jsonb_build_object('status','paired','partner_name',partner.full_name,'partner_phone',partner.phone,'booking_name',(select full_name from public.profiles where id=pair.booking_user),'booking_me',pair.booking_user=uid,'confirmed_at',pair.confirmed_at,'updated_at',pair.updated_at);
end $$;
create or replace function baseline_private.event_tee_groups(event bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ev public.baseline_events; groups_json jsonb; secret boolean; provisional boolean;
begin
 if not baseline_private.active_member() then raise exception 'Member sign-in required'; end if;
 select * into ev from public.baseline_events where id=event;
 if ev.id is null then raise exception 'Event not found'; end if;
 if ev.cancelled or ev.tee_times_dirty then return jsonb_build_object('status',case when ev.cancelled then 'cancelled' else 'reviewing' end,'groups','[]'::jsonb); end if;
 secret:=ev.round_number>=7 and not public.is_admin();
 provisional:=exists(select 1 from generate_series(1,ev.round_number-1) n where not exists(select 1 from baseline_private.league_rounds r where r.round_number=n and r.published_entries is not null));
 select coalesce(jsonb_agg(jsonb_build_object('group_number',t.group_number,'tee_time',t.tee_time,'players',(
  select coalesce(jsonb_agg(jsonb_build_object('user_id',p.id,'name',p.full_name,'avatar_path',p.baseline_avatar_path,'handicap',case when secret then null else baseline_private.handicap_at(p.id,coalesce(ev.round_number,1)) end,'handicap_secret',coalesce(secret,false),'type',a.value->>'type') order by a.ordinality),'[]'::jsonb)
  from jsonb_array_elements(t.players) with ordinality a(value,ordinality) join public.profiles p on p.id::text=a.value->>'user_id' join public.baseline_member_accounts m on m.user_id=p.id and not m.disabled
 )) order by t.group_number),'[]'::jsonb) into groups_json from public.baseline_tee_times t where t.event_id=event;
 return jsonb_build_object('status',case when jsonb_array_length(groups_json)=0 then 'unpublished' else 'published' end,'published_at',ev.tee_published_at,'revision',ev.tee_revision,'round_number',ev.round_number,'provisional',case when secret then false else provisional end,'groups',groups_json);
end $$;
create unique index baseline_guest_once on baseline_private.guest_requests(host_id,event_id,lower(trim(name)));
create function baseline_private.link_new_operations() returns trigger language plpgsql security definer set search_path='' as $$
declare invitation baseline_private.guest_requests; config baseline_private.operations_settings;
begin
 select * into invitation from baseline_private.guest_requests where member_id=new.member_id and status='approved' order by created_at desc limit 1;
 insert into baseline_private.member_types(user_id,category) values(new.user_id,case when invitation.id is null then 'member' else 'guest' end) on conflict(user_id) do nothing;
 if invitation.id is not null and invitation.approved_handicap is not null then update public.profiles set handicap=invitation.approved_handicap where id=new.user_id; end if;
 select * into config from baseline_private.operations_settings;
 if invitation.id is null and config.membership_fee is not null then
 insert into baseline_private.charges(user_id,scope,label,amount,due_date) values(new.user_id,'membership:2027','2027 membership',config.membership_fee,config.membership_due) on conflict(user_id,scope) do nothing; end if;
 return new;
end $$;
create trigger baseline_link_operations after insert on public.baseline_member_accounts for each row execute function baseline_private.link_new_operations();
revoke all on function baseline_private.link_new_operations() from public,anon,authenticated;

create function baseline_private.operations(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
   from public.baseline_rsvps r left join baseline_private.member_types t on t.user_id=r.user_id where r.event_id=eid and r.attending and not r.reserve and (case when t.category='guest' then ev.guest_price else ev.member_price end) is not null on conflict(user_id,scope) do nothing;
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
end $$;
create function public.baseline_operations(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select baseline_private.operations(action,payload);$$;
revoke all on function baseline_private.operations(text,jsonb),public.baseline_operations(text,jsonb) from public,anon,authenticated;
grant execute on function baseline_private.operations(text,jsonb),public.baseline_operations(text,jsonb) to authenticated;
