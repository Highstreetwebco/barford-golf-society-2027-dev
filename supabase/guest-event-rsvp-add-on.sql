-- Named, account-free guest RSVPs for the 2027 project only.
-- Guests join the existing RSVP queue; receipts hold the private browser token.
-- Deliberate public API: guests authorise their own receipt with a random 256-bit
-- capability, not a member session. No anonymous table access or profile reads.
begin;
-- Anonymous reads must not invoke the member-only is_admin helper.
alter policy "Everyone can read scheduled content" on public.events to authenticated;
create policy "Guests read published events" on public.events for select to anon
  using (status in ('scheduled','completed','cancelled'));
create schema if not exists barford_private;
revoke all on schema barford_private from public;
grant usage on schema barford_private to anon, authenticated;
alter table public.rsvps alter column member_id drop not null;
alter table public.rsvps add constraint rsvp_member_or_named_guest check
  (member_id is not null or coalesce(length(btrim(guest_name)) between 2 and 110,false));
alter table public.guest_rsvps enable row level security;
alter table public.guest_rsvps alter column guest_email drop not null;
alter table public.guest_rsvps alter column amount_due drop not null;
alter table public.guest_rsvps add column rsvp_id uuid unique references public.rsvps(id) on delete cascade;
revoke all on public.guest_rsvps from anon, authenticated;

create function barford_private.guest_event_state(p_event_id uuid, p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare e public.events; own jsonb; played bigint; reserved bigint; guests bigint;
begin
 select * into e from public.events where id=p_event_id and status in ('scheduled','completed','cancelled');
 if not found then raise exception 'Event unavailable'; end if;
 select count(*) filter(where status='playing'),count(*) filter(where status='reserve'),count(*) filter(where status='playing' and member_id is null)
 into played,reserved,guests from public.rsvps where event_id=p_event_id;
 if p_token ~ '^[a-f0-9]{64}$' then
  select jsonb_build_object('guest_name',g.guest_name,'status',r.status,'payment_status',r.payment_status,'amount_due',g.amount_due)
  into own from public.guest_rsvps g join public.rsvps r on r.id=g.rsvp_id
  where g.event_id=p_event_id and g.manage_token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
 end if;
 return jsonb_build_object('booking',own,'capacity',e.capacity,'playing_count',played,'reserve_count',reserved,
  'available',case when e.capacity is null then null else greatest(e.capacity-played,0) end,
  'guest_available',case when e.guest_capacity is null then null else greatest(e.guest_capacity-guests,0) end,
  'locked',exists(select 1 from public.tee_times where event_id=p_event_id) or e.tee_times_status <> 'not_started');
end $$;
revoke all on function barford_private.guest_event_state(uuid,text) from public;
grant execute on function barford_private.guest_event_state(uuid,text) to anon,authenticated;
create function public.get_guest_event_state(p_event_id uuid,p_token text default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
 select barford_private.guest_event_state(p_event_id,p_token);
$$;
revoke all on function public.get_guest_event_state(uuid,text) from public;
grant execute on function public.get_guest_event_state(uuid,text) to anon,authenticated;

create function barford_private.create_guest_rsvp(p_event_id uuid,p_name text,p_token text,p_buggy_requested boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.events; receipt public.guest_rsvps; entry public.rsvps; clean_name text;
 token_hash text; guest_count integer; final_status text := 'playing';
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid booking token'; end if;
 clean_name := regexp_replace(btrim(p_name),'\s+',' ','g');
 if clean_name is null or length(clean_name) not between 2 and 100 then raise exception 'Please enter your full name (2–100 characters).'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
 token_hash := encode(extensions.digest(p_token,'sha256'),'hex');
 select * into receipt from public.guest_rsvps where manage_token_hash=token_hash;
 if found then
  if receipt.event_id <> p_event_id then raise exception 'Booking token belongs to another event'; end if;
  return barford_private.guest_event_state(p_event_id,p_token)->'booking';
 end if;
 select * into e from public.events where id=p_event_id for update;
 if not found or e.status <> 'scheduled' or e.event_date < (now() at time zone 'Europe/London')::date then raise exception 'Guest RSVPs are closed for this event.'; end if;
 if not e.guests_allowed then raise exception 'This event is for members only.'; end if;
 if e.tee_times_status <> 'not_started' or exists(select 1 from public.tee_times where event_id=p_event_id) then raise exception 'Bookings are closed. Please contact the committee.'; end if;
 select count(*) into guest_count from public.rsvps where event_id=p_event_id and member_id is null and status='playing';
 if e.guest_capacity is not null and guest_count>=e.guest_capacity then final_status:='reserve'; end if;
 insert into public.rsvps(event_id,member_id,guest_name,status,buggy_requested,preferred_tee_time)
 values(p_event_id,null,clean_name || ' (guest)',final_status,coalesce(p_buggy_requested,false),'dont_mind') returning * into entry;
 insert into public.guest_rsvps(rsvp_id,event_id,guest_name,amount_due,status,buggy_requested,manage_token_hash)
 values(entry.id,p_event_id,clean_name,coalesce(e.guest_price,e.price),entry.status,entry.buggy_requested,token_hash);
 return barford_private.guest_event_state(p_event_id,p_token)->'booking';
end $$;
revoke all on function barford_private.create_guest_rsvp(uuid,text,text,boolean) from public;
grant execute on function barford_private.create_guest_rsvp(uuid,text,text,boolean) to anon,authenticated;
create function public.create_guest_event_rsvp(p_event_id uuid,p_name text,p_token text,p_buggy_requested boolean default false)
returns jsonb language sql security invoker set search_path = '' as $$
 select barford_private.create_guest_rsvp(p_event_id,p_name,p_token,p_buggy_requested);
$$;
revoke all on function public.create_guest_event_rsvp(uuid,text,text,boolean) from public;
grant execute on function public.create_guest_event_rsvp(uuid,text,text,boolean) to anon,authenticated;

-- All entry points share the event lock, including concurrent member/guest RSVPs.
create or replace function public.enforce_event_capacity()
returns trigger language plpgsql set search_path = '' as $$
declare cap integer; occupied integer; gcap integer;
begin
 if new.status='playing' and (tg_op='INSERT' or old.status is distinct from 'playing') then
  perform pg_advisory_xact_lock(hashtextextended(new.event_id::text,0));
  select capacity,guest_capacity into cap,gcap from public.events where id=new.event_id;
  select count(*) into occupied from public.rsvps where event_id=new.event_id and status='playing' and id is distinct from new.id;
  if cap is not null and occupied>=cap then new.status:='reserve'; end if;
  if new.member_id is null and gcap is not null then
   select count(*) into occupied from public.rsvps where event_id=new.event_id and status='playing' and member_id is null and id is distinct from new.id;
   if occupied>=gcap then new.status:='reserve'; end if;
  end if;
 end if;
 return new;
end $$;

create or replace function public.set_my_event_rsvp(p_event_id uuid,p_status text,p_buggy_requested boolean default false,p_preferred_tee_time text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare entry public.rsvps;
begin
 if auth.uid() is null then raise exception 'Please sign in.'; end if;
 if p_status not in ('playing','not_playing') then raise exception 'Invalid RSVP status'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
 if not exists(select 1 from public.events where id=p_event_id and status='scheduled') then raise exception 'Event unavailable'; end if;
 insert into public.rsvps(event_id,member_id,status,buggy_requested,preferred_tee_time)
 values(p_event_id,auth.uid(),p_status,coalesce(p_buggy_requested,false),p_preferred_tee_time)
 on conflict(event_id,member_id) do update set status=p_status,buggy_requested=excluded.buggy_requested,preferred_tee_time=excluded.preferred_tee_time,updated_at=now()
 returning * into entry;
 return entry.status;
end $$;

-- Include named guests in existing member-facing rosters. Profile photos remain
-- member-only; no guest receipt, contact detail or capability is returned.
create or replace function public.get_event_rsvp_roster(p_event_id uuid)
returns table(member_id uuid,full_name text,photo_url text,status text,joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
 select r.member_id,coalesce(p.full_name,r.guest_name),p.photo_url,r.status,r.created_at
 from public.rsvps r left join public.profiles p on p.id=r.member_id
 where r.event_id=p_event_id and r.status in ('playing','reserve') and auth.uid() is not null
 order by case when r.status='playing' then 0 else 1 end,r.created_at;
$$;
create or replace function public.get_event_playing_list(target_event_id uuid)
returns table(member_id uuid,full_name text)
language sql stable security definer set search_path = '' as $$
 select r.member_id,coalesce(p.full_name,r.guest_name)
 from public.rsvps r left join public.profiles p on p.id=r.member_id
 where r.event_id=target_event_id and r.status='playing' and auth.uid() is not null
 order by lower(coalesce(p.full_name,r.guest_name));
$$;
-- Preserve the shared reserve queue without attempting member notifications for guests.
create function barford_private.promote_event_reserve(p_event_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.events; occupied integer; guest_count integer; candidate public.rsvps;
begin
 if auth.uid() is null and coalesce(auth.role(),'') <> 'service_role' then return; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
 select * into e from public.events where id=p_event_id;
 if not found or e.status <> 'scheduled' or exists(select 1 from public.tee_times where event_id=p_event_id) then return; end if;
 select count(*),count(*) filter(where member_id is null) into occupied,guest_count from public.rsvps where event_id=p_event_id and status='playing';
 if e.capacity is not null and occupied>=e.capacity then return; end if;
 select * into candidate from public.rsvps where event_id=p_event_id and status='reserve'
 and (member_id is not null or e.guest_capacity is null or guest_count<e.guest_capacity)
 order by created_at,id limit 1 for update skip locked;
 if found then
  update public.rsvps set status='playing',updated_at=now() where id=candidate.id;
  if candidate.member_id is not null then insert into public.rsvp_promotions(event_id,member_id) values(p_event_id,candidate.member_id); end if;
 end if;
end $$;
revoke all on function barford_private.promote_event_reserve(uuid) from public,anon,authenticated;
create or replace function public.promote_next_event_reserve()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if old.status='playing' and new.status is distinct from 'playing' then perform barford_private.promote_event_reserve(new.event_id); end if;
 return new;
end $$;
create or replace function public.promote_reserve_after_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if old.status='playing' then perform barford_private.promote_event_reserve(old.event_id); end if;
 return old;
end $$;
notify pgrst, 'reload schema';
commit;
