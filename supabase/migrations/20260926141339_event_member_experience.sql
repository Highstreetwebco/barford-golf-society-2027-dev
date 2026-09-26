create table public.baseline_members (
 id uuid primary key default gen_random_uuid(), name text not null unique check(length(name) between 1 and 150)
);
create table public.baseline_member_accounts (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 member_id uuid unique references public.baseline_members(id), disabled boolean not null default false
);
alter table public.baseline_members enable row level security;
alter table public.baseline_member_accounts enable row level security;
revoke all on public.baseline_members,public.baseline_member_accounts from anon,authenticated;
grant select on public.baseline_members to anon,authenticated;
grant select on public.baseline_member_accounts to authenticated;
create policy "Public scoreboard names" on public.baseline_members for select to anon,authenticated using(true);
create policy "Own member account" on public.baseline_member_accounts for select to authenticated using(user_id=(select auth.uid()) or (select public.is_admin()));
-- Roster insert is appended by the migration generator before account matching.
insert into public.baseline_members(name) values ('Adrian Simms'),('Bekim'),('Brad Davies'),('Burt Pickering'),('Calvin Santana-Vaz'),('Cam Tolley'),('Charlie Collings'),('Chris Harris'),('Chris Oliver'),('Clive Irwin'),('Colin Oliver'),('Craig Carter'),('Dave Richards'),('David Hardcastle'),('David Jordan'),('David Pritchard'),('Derek Lewis'),('Elliot Hobbs'),('Emma Saywell'),('Eric Dearnum'),('Gary Moyce'),('Jack Troth'),('James Beaven'),('John Blackwell'),('John Close'),('John Hawkes'),('Liz Oliver'),('Lucie Byerley'),('Marc Taylor'),('Matt Hardy'),('Matt Oliver'),('Mike Cook'),('Nick Benbow'),('Nick Wright'),('Paul Maynard'),('Philip Morris'),('Richard Jones'),('Robert Pocknell'),('Ryan Leech'),('Simon Meade'),('Simon Morgan'),('Tim Oliver'),('Tim Sewards'),('Vince Hall'),('Wes Lacey'),('Will Hunt'),('Will Lovell'),('Zac Lovell');
insert into public.baseline_member_accounts(user_id,member_id)
select p.id,m.id from public.profiles p left join public.baseline_members m on lower(trim(p.full_name))=lower(m.name);

create function baseline_private.claim_member(who uuid, mobile text, confirmed boolean)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); n text;
begin
 if uid is null then raise exception 'Sign in first'; end if;
 if confirmed is distinct from true then raise exception 'Confirm that this is your own name'; end if;
 if mobile is null or mobile !~ '^\+?[0-9 ()-]{10,25}$' or length(regexp_replace(mobile,'[^0-9]','','g')) not between 10 and 15 then raise exception 'Enter a valid mobile number'; end if;
 if exists(select 1 from public.baseline_member_accounts where user_id=uid and (disabled or member_id is not null)) then raise exception 'Your account already has a name or needs organiser help'; end if;
 select name into n from public.baseline_members where id=who for update;
 if n is null then raise exception 'Choose your name from the list'; end if;
 if exists(select 1 from public.baseline_member_accounts where member_id=who) then raise exception 'This name already has an account. Sign in or contact an organiser'; end if;
 insert into public.baseline_member_accounts(user_id,member_id) values(uid,who) on conflict(user_id) do update set member_id=excluded.member_id;
 update public.profiles set full_name=n,phone=trim(mobile) where id=uid;
end $$;
create function public.baseline_claim_member(who uuid,mobile text,confirmed boolean) returns void language sql security invoker set search_path='' as $$select baseline_private.claim_member(who,mobile,confirmed);$$;
revoke all on function baseline_private.claim_member(uuid,text,boolean),public.baseline_claim_member(uuid,text,boolean) from public,anon;
grant execute on function baseline_private.claim_member(uuid,text,boolean),public.baseline_claim_member(uuid,text,boolean) to authenticated;

create function baseline_private.new_member() returns trigger language plpgsql security definer set search_path='' as $$
declare meta jsonb; n text; who uuid;
begin
 select raw_user_meta_data into meta from auth.users where id=new.id;
 who:=(meta->>'roster_id')::uuid;
 if who is null or meta->>'name_confirmation' is distinct from 'true' then raise exception 'Choose your own scoreboard name and confirm it'; end if;
 if new.phone is null or new.phone !~ '^\+?[0-9 ()-]{10,25}$' or length(regexp_replace(new.phone,'[^0-9]','','g')) not between 10 and 15 then raise exception 'Enter a valid mobile number'; end if;
 select name into n from public.baseline_members where id=who for update;
 if n is null then raise exception 'Choose your name from the list'; end if;
 if exists(select 1 from public.baseline_member_accounts where member_id=who) then raise exception 'This name already has an account'; end if;
 insert into public.baseline_member_accounts(user_id,member_id) values(new.id,who);
 update public.profiles set full_name=n where id=new.id;
 return new;
end $$;
revoke all on function baseline_private.new_member() from public,anon,authenticated;
create trigger baseline_claim_new_member after insert on public.profiles for each row execute function baseline_private.new_member();
create function baseline_private.protect_username() returns trigger language plpgsql security definer set search_path='' as $$
declare n text;
begin
 select m.name into n from public.baseline_member_accounts a join public.baseline_members m on m.id=a.member_id where a.user_id=new.id;
 if n is not null then new.full_name:=n; end if;
 return new;
end $$;
revoke all on function baseline_private.protect_username() from public,anon,authenticated;
create trigger baseline_protect_username before update of full_name on public.profiles for each row execute function baseline_private.protect_username();
create function baseline_private.member_roster() returns table(id uuid,name text,claimed boolean) language sql stable security definer set search_path='' as $$
 select m.id,m.name,exists(select 1 from public.baseline_member_accounts a where a.member_id=m.id) from public.baseline_members m order by m.name;
$$;
create function public.baseline_member_roster() returns table(id uuid,name text,claimed boolean) language sql stable security invoker set search_path='' as $$select * from baseline_private.member_roster();$$;
revoke all on function baseline_private.member_roster(),public.baseline_member_roster() from public;
grant execute on function baseline_private.member_roster(),public.baseline_member_roster() to anon,authenticated;

alter table public.baseline_events add column course_name text, add column address text, add column latitude double precision check(latitude between -90 and 90), add column longitude double precision check(longitude between -180 and 180), add column cover_url text, add column cover_credit text, add column place_id text, add column round_hours integer not null default 5 check(round_hours between 2 and 8);
create table public.baseline_buggy_pairs (
 id bigint generated always as identity primary key, event_id bigint not null references public.baseline_events(id) on delete cascade,
 first_user uuid not null references public.profiles(id),second_user uuid not null references public.profiles(id),
 booking_user uuid references public.profiles(id), updated_at timestamptz not null default now(),
 check(first_user<second_user),check(booking_user is null or booking_user in (first_user,second_user)),unique(event_id,first_user,second_user)
);
create index baseline_buggy_event_idx on public.baseline_buggy_pairs(event_id);
create index baseline_buggy_second_idx on public.baseline_buggy_pairs(second_user);
create index baseline_buggy_booking_idx on public.baseline_buggy_pairs(booking_user);
alter table public.baseline_buggy_pairs enable row level security;
revoke all on public.baseline_buggy_pairs from anon,authenticated;
-- All pair/contact reads go through the participant-checked RPC.
create function baseline_private.buggy_details(event bigint, claim boolean default false, release boolean default false)
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
  update public.baseline_buggy_pairs set booking_user=null,updated_at=now() where id=pair.id returning * into pair;
 end if;
 select * into partner from public.profiles where id=case when pair.first_user=uid then pair.second_user else pair.first_user end;
 return jsonb_build_object('status','paired','partner_name',partner.full_name,'partner_phone',partner.phone,'booking_name',(select full_name from public.profiles where id=pair.booking_user),'booking_me',pair.booking_user=uid,'updated_at',pair.updated_at);
end $$;
create function public.baseline_buggy_details(event bigint,claim boolean default false,release boolean default false) returns jsonb language sql security invoker set search_path='' as $$select baseline_private.buggy_details(event,claim,release);$$;
revoke all on function baseline_private.buggy_details(bigint,boolean,boolean),public.baseline_buggy_details(bigint,boolean,boolean) from public,anon;
grant execute on function baseline_private.buggy_details(bigint,boolean,boolean),public.baseline_buggy_details(bigint,boolean,boolean) to authenticated;

create function baseline_private.release_member(who uuid) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid; ev record;
begin
 if not public.is_admin() then raise exception 'Organiser access required'; end if;
 select user_id into uid from public.baseline_member_accounts where member_id=who for update;
 if uid is null then raise exception 'Name is not claimed'; end if;
 if exists(select 1 from public.profiles where id=uid and is_admin) then raise exception 'Organiser accounts require manual recovery'; end if;
 -- Cancel future RSVPs through the ordinary capacity/promotion transaction before blocking the account.
 for ev in select e.id from public.baseline_events e join public.baseline_rsvps r on r.event_id=e.id where r.user_id=uid and e.date>=current_date and not e.cancelled loop
  perform baseline_private.submit_rsvp(jsonb_build_object('event_id',ev.id,'user_id',uid,'attending',false));
 end loop;
 update public.baseline_member_accounts set member_id=null,disabled=true where user_id=uid;
end $$;
create function public.baseline_release_member(who uuid) returns void language sql security invoker set search_path='' as $$select baseline_private.release_member(who);$$;
revoke all on function baseline_private.release_member(uuid),public.baseline_release_member(uuid) from public,anon;
grant execute on function baseline_private.release_member(uuid),public.baseline_release_member(uuid) to authenticated;

-- Persistent request budgets protect public username login and forecast refreshes.
create table public.baseline_request_limits(key text primary key,started_at timestamptz not null,hits integer not null);
alter table public.baseline_request_limits enable row level security;
revoke all on public.baseline_request_limits from anon,authenticated;
create function public.baseline_take_budget(bucket text,seconds integer,maximum integer) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server only'; end if;
 insert into public.baseline_request_limits values(bucket,now(),1) on conflict(key) do update set hits=case when baseline_request_limits.started_at<now()-make_interval(secs=>seconds) then 1 else baseline_request_limits.hits+1 end,started_at=case when baseline_request_limits.started_at<now()-make_interval(secs=>seconds) then now() else baseline_request_limits.started_at end returning hits into n;
 delete from public.baseline_request_limits where started_at<now()-interval '2 days';
 return n<=maximum;
end $$;
revoke all on function public.baseline_take_budget(text,integer,integer) from public,anon,authenticated;
grant execute on function public.baseline_take_budget(text,integer,integer) to service_role;
create table public.baseline_weather(event_id bigint primary key references public.baseline_events(id) on delete cascade,forecast jsonb not null,updated_at timestamptz not null default now());
alter table public.baseline_weather enable row level security;
revoke all on public.baseline_weather from anon,authenticated;
grant select on public.baseline_weather to anon,authenticated;
create policy "Public event forecast" on public.baseline_weather for select to anon,authenticated using(true);

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

create or replace function baseline_private.save_tee_times(event bigint,groups jsonb)
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
