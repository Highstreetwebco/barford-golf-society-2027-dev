begin;
alter table public.events disable trigger sync_event_round_after_write;
insert into public.events(id,name,venue,event_date,round_number,status,price,guest_price,course_member_price,capacity)
values('f746d49b-f786-4839-bbec-4298b3adf4bc','Three rate transaction test','Test course','2099-09-14',7,'scheduled',40,55,10,20);
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where is_admin=false limit 1),true);
set local role authenticated;
do $test$
begin
if auth.uid() is null then raise exception 'No test member'; end if;
perform public.set_my_priced_event_rsvp('f746d49b-f786-4839-bbec-4298b3adf4bc','playing',false,'dont_mind',true);
if not exists(select 1 from public.rsvps where event_id='f746d49b-f786-4839-bbec-4298b3adf4bc' and member_id=auth.uid() and is_course_member) then raise exception 'Course price not saved'; end if;
perform public.set_my_priced_event_rsvp('f746d49b-f786-4839-bbec-4298b3adf4bc','playing',false,'dont_mind',false);
if exists(select 1 from public.rsvps where event_id='f746d49b-f786-4839-bbec-4298b3adf4bc' and is_course_member) then raise exception 'Standard price not saved'; end if;
end $test$;
reset role;
update public.rsvps set payment_status='paid' where event_id='f746d49b-f786-4839-bbec-4298b3adf4bc';
set local role authenticated;
do $test$
begin
begin
perform public.set_my_priced_event_rsvp('f746d49b-f786-4839-bbec-4298b3adf4bc','playing',true,'dont_mind',true);
raise exception 'Settled rate change allowed' using errcode='ZX001';
exception when others then if sqlstate='ZX001' then raise; end if; end;
if exists(select 1 from public.rsvps where event_id='f746d49b-f786-4839-bbec-4298b3adf4bc' and (is_course_member or buggy_requested)) then raise exception 'Failed booking partially saved'; end if;
end $test$;
reset role;
select 'Course and standard rates, settled payment protection, atomic rollback passed' as result;
rollback;
