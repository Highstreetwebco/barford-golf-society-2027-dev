-- Preserve externally reserved buggies when a pair changes; never silently forget a reservation.
create table baseline_private.reservation_alerts(id bigint generated always as identity primary key,event_id bigint references public.baseline_events(id),booking_user uuid references public.profiles(id),message text not null,resolved boolean not null default false,created_at timestamptz default now());
create index baseline_reservation_alert_owner on baseline_private.reservation_alerts(booking_user,event_id);
alter table baseline_private.reservation_alerts enable row level security;
revoke all on baseline_private.reservation_alerts from public,anon,authenticated;
create function baseline_private.buggy_reservation_removed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.booking_user is not null then
 insert into baseline_private.reservation_alerts(event_id,booking_user,message) values(old.event_id,old.booking_user,'Your previous buggy pairing changed. Contact the course and your former partner to transfer or cancel any reservation. A website change does not cancel a course booking.');
 end if;return old;
end $$;
create trigger baseline_buggy_reservation_removed before delete on public.baseline_buggy_pairs for each row execute function baseline_private.buggy_reservation_removed();
revoke all on function baseline_private.buggy_reservation_removed() from public,anon,authenticated;
create function baseline_private.reservation_notices(event bigint,resolve_id bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not baseline_private.active_member() then raise exception 'Member sign-in required'; end if;
 if resolve_id is not null then update baseline_private.reservation_alerts set resolved=true where id=resolve_id and (booking_user=auth.uid() or public.is_admin());if not found then raise exception 'Reservation notice not found';end if;end if;
 return coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('booking_name',p.full_name)) from baseline_private.reservation_alerts a join public.profiles p on p.id=a.booking_user where not resolved and event_id=event and (booking_user=auth.uid() or public.is_admin())),'[]'::jsonb);
end $$;
create function public.baseline_reservation_notices(event bigint,resolve_id bigint default null) returns jsonb language sql security invoker set search_path='' as $$select baseline_private.reservation_notices(event,resolve_id);$$;
revoke all on function baseline_private.reservation_notices(bigint,bigint),public.baseline_reservation_notices(bigint,bigint) from public,anon,authenticated;
grant execute on function baseline_private.reservation_notices(bigint,bigint),public.baseline_reservation_notices(bigint,bigint) to authenticated;
create function baseline_private.operations_event_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare occupied integer;candidate record;
begin
 if new.max_players is distinct from old.max_players and (new.max_players is null or new.max_players>coalesce(old.max_players,0)) and not new.cancelled then
 select count(*) into occupied from public.baseline_rsvps where event_id=new.id and attending and not reserve;
 for candidate in select id from public.baseline_rsvps where event_id=new.id and reserve order by requested_at,id loop
 exit when new.max_players is not null and occupied>=new.max_players;
 update public.baseline_rsvps set attending=true,reserve=false,updated_at=now() where id=candidate.id;
 occupied:=occupied+1;
 end loop;
 if exists(select 1 from public.baseline_tee_times where event_id=new.id) then update public.baseline_events set tee_times_dirty=true where id=new.id;end if;
 end if;
 return new;
end $$;
create trigger baseline_operations_capacity after update of max_players on public.baseline_events for each row execute function baseline_private.operations_event_changed();
create function baseline_private.operations_event_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.rsvp_deadline>new.date or new.cancellation_deadline>new.date then raise exception 'RSVP and cancellation deadlines must be on or before the event';end if;
 if new.guest_price<0 then raise exception 'Guest price cannot be negative';end if;
 if tg_op='UPDATE' then
 if new.event_type is distinct from old.event_type and exists(select 1 from public.baseline_rsvps where event_id=new.id) then raise exception 'Event type cannot change after responses arrive. Create the correct event type first';end if;
 if exists(select 1 from public.baseline_tee_times where event_id=new.id) and (new.date is distinct from old.date or new.first_time is distinct from old.first_time or new.tee_interval is distinct from old.tee_interval or new.cancelled is distinct from old.cancelled) then new.tee_times_dirty:=true;end if;
 end if;
 return new;
end $$;
create trigger baseline_operations_event_guard before insert or update on public.baseline_events for each row execute function baseline_private.operations_event_guard();
revoke all on function baseline_private.operations_event_changed(),baseline_private.operations_event_guard() from public,anon,authenticated;
alter table baseline_private.charges add constraint baseline_finite_charges check(amount::text not in ('NaN','Infinity','-Infinity') and received::text not in ('NaN','Infinity','-Infinity'));
alter table baseline_private.committee_items add constraint baseline_finite_items check(amount::text not in ('NaN','Infinity','-Infinity'));
alter table baseline_private.operations_settings add constraint baseline_finite_fee check(membership_fee::text not in ('NaN','Infinity','-Infinity'));
alter table baseline_private.guest_requests add constraint baseline_guest_hcp check(approved_handicap is null or (approved_handicap between 0 and 36 and round(approved_handicap,1)=approved_handicap));
