-- Run only on xspzmthygrajzktydvvj. All synthetic users and rows roll back.
begin;
create temp table qa_ids (u1 uuid,u2 uuid,organiser uuid,event_id bigint,trip_id bigint);
insert into qa_ids select gen_random_uuid(),gen_random_uuid(),(select id from public.profiles where is_admin limit 1),null,null;
grant select on qa_ids to authenticated,anon;
insert into public.baseline_members(id,name) select u1,'QA Test One' from qa_ids union all select u2,'QA Test Two' from qa_ids;
insert into auth.users(id,email,raw_user_meta_data,aud,role,created_at,updated_at)
select u1,'barford-test-a-'||u1||'@example.invalid',jsonb_build_object('roster_id',u1,'full_name','Forged Name','phone','07000000001','name_confirmation',true),'authenticated','authenticated',now(),now() from qa_ids
union all select u2,'barford-test-b-'||u2||'@example.invalid',jsonb_build_object('roster_id',u2,'full_name','Forged Name','phone','07000000002','name_confirmation',true),'authenticated','authenticated',now(),now() from qa_ids;
with ev as (insert into public.baseline_events(name,date,max_players) values('Temporary RSVP verification',current_date+60,1) returning id)
update qa_ids set event_id=(select id from ev);
with trip as (insert into public.baseline_trip_events(name) values('Temporary trip verification') returning id)
update qa_ids set trip_id=(select id from trip);

select set_config('request.jwt.claim.sub',(select u1::text from qa_ids),true);
set local role authenticated;
select public.baseline_submit_rsvp(jsonb_build_object('event_id',(select event_id from qa_ids),'attending',true));
reset role;
update public.baseline_events set tee_published_at=now() where id=(select event_id from qa_ids);
set local role authenticated;
do $$ begin
 begin
  perform public.baseline_submit_rsvp(jsonb_build_object('event_id',(select event_id from qa_ids),'attending',false));
  raise exception 'Published RSVP change was accepted';
 exception when raise_exception then
  if sqlerrm <> 'If you need to withdraw from the event please contact the committee' then raise; end if;
 end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select organiser::text from qa_ids),true);
set local role authenticated;
select public.baseline_submit_rsvp(jsonb_build_object('event_id',(select event_id from qa_ids),'user_id',(select u1 from qa_ids),'attending',false));
reset role;
rollback;
