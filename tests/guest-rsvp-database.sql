-- Run after guest-event-rsvp-add-on.sql; every test record is rolled back.
begin;

insert into public.events(id,name,venue,event_date,round_number,status,price,guest_price,capacity,guest_capacity,guests_allowed)
values('f746d49b-f786-4839-bbec-4298b3adf4bb','Guest RSVP transaction test','Test course','2099-09-14',7,'scheduled',40,55,1,1,true);
set local role anon;
do $test$
declare first_booking jsonb; again jsonb; reserve_booking jsonb; info jsonb;
begin
 perform id from public.events where id='f746d49b-f786-4839-bbec-4298b3adf4bb';
 first_booking := public.create_guest_event_rsvp('f746d49b-f786-4839-bbec-4298b3adf4bb','  Guest   Example  ',repeat('a',64),false);
 if first_booking->>'status' <> 'playing' or first_booking->>'guest_name' <> 'Guest Example' or (first_booking->>'amount_due')::numeric <> 55 then raise exception 'First booking or guest price failed: %',first_booking; end if;
 again := public.create_guest_event_rsvp('f746d49b-f786-4839-bbec-4298b3adf4bb','Different name',repeat('a',64),false);
 if again <> first_booking then raise exception 'Idempotent retry failed'; end if;
 reserve_booking := public.create_guest_event_rsvp('f746d49b-f786-4839-bbec-4298b3adf4bb','Reserve Example',repeat('b',64),true);
 if reserve_booking->>'status' <> 'reserve' then raise exception 'Capacity failed'; end if;
 info := public.get_guest_event_state('f746d49b-f786-4839-bbec-4298b3adf4bb',repeat('c',64));
 if info->'booking' <> 'null'::jsonb or (info->>'playing_count')::int <> 1 or (info->>'reserve_count')::int <> 1 then raise exception 'Privacy or counts failed: %',info; end if;
 begin
  perform public.create_guest_event_rsvp('f746d49b-f786-4839-bbec-4298b3adf4bb',' ',repeat('d',64),false);
  raise exception 'Empty name accepted' using errcode='ZX001';
 exception when others then if sqlstate='ZX001' then raise; end if; end;
 begin
  perform 1 from public.guest_rsvps;
  raise exception 'Guest receipts readable' using errcode='ZX001';
 exception when insufficient_privilege then null; end;
end $test$;
reset role;
select set_config('request.jwt.claim.sub','f64e3b47-9e44-43ee-a9a5-d756b115f247',true);
do $test$
begin
 if not exists(select 1 from public.get_event_rsvp_roster('f746d49b-f786-4839-bbec-4298b3adf4bb') where full_name='Guest Example (guest)') then raise exception 'Guest missing from member roster'; end if;
end $test$;
update public.rsvps set status='cancelled' where event_id='f746d49b-f786-4839-bbec-4298b3adf4bb' and guest_name='Guest Example (guest)';
do $test$
begin
 if not exists(select 1 from public.rsvps where event_id='f746d49b-f786-4839-bbec-4298b3adf4bb' and guest_name='Reserve Example (guest)' and status='playing') then raise exception 'Guest reserve promotion failed'; end if;
end $test$;
update public.events set guests_allowed=false where id='f746d49b-f786-4839-bbec-4298b3adf4bb';
set local role anon;
do $test$
begin
 begin
  perform public.create_guest_event_rsvp('f746d49b-f786-4839-bbec-4298b3adf4bb','Closed Example',repeat('e',64),false);
  raise exception 'Members-only event accepted guest' using errcode='ZX001';
 exception when others then if sqlstate='ZX001' then raise; end if; end;
end $test$;
reset role;
select 'Guest RSVP, reserve, retry, privacy, roster and promotion checks passed' as result;

rollback;
