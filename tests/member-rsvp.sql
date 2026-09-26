-- Run only on xspzmthygrajzktydvvj. All synthetic users and rows roll back.
begin;
create temp table qa_ids (u1 uuid,u2 uuid,organiser uuid,event_id bigint,trip_id bigint);
insert into qa_ids select gen_random_uuid(),gen_random_uuid(),(select id from public.profiles where is_admin limit 1),null,null;
grant select on qa_ids to authenticated,anon;
insert into auth.users(id,email,raw_user_meta_data,aud,role,created_at,updated_at)
select u1,'barford-test-a-'||u1||'@example.invalid','{"full_name":"Same Test Name"}'::jsonb,'authenticated','authenticated',now(),now() from qa_ids
union all select u2,'barford-test-b-'||u2||'@example.invalid','{"full_name":"Same Test Name"}'::jsonb,'authenticated','authenticated',now(),now() from qa_ids;
with ev as (insert into public.baseline_events(name,date,max_players) values('Temporary RSVP verification',current_date+60,1) returning id)
update qa_ids set event_id=(select id from ev);
with trip as (insert into public.baseline_trip_events(name) values('Temporary trip verification') returning id)
update qa_ids set trip_id=(select id from trip);
select set_config('request.jwt.claim.sub',(select u1::text from qa_ids),true);
set local role authenticated;
do $$ declare a jsonb;b jsonb; ev bigint:=(select event_id from qa_ids);begin
 a:=public.baseline_submit_rsvp(jsonb_build_object('event_id',ev,'attending',true,'buggy',false,'preferred_time','First'));
 b:=public.baseline_submit_rsvp(jsonb_build_object('event_id',ev,'attending',true,'buggy',true,'preferred_time','End'));
 if a->>'id'<>b->>'id' or not (b->>'attending')::boolean or (select count(*) from public.baseline_rsvps where event_id=ev)<>1 then raise exception 'Repeated RSVP duplicated or failed'; end if;
 if exists(select 1 from public.baseline_rsvps where event_id=ev and (buggy<>true or preferred_time<>'End')) then raise exception 'Edit failed';end if;
 begin
  perform public.baseline_submit_rsvp(jsonb_build_object('event_id',ev,'user_id',(select u2 from qa_ids),'attending',true,'preferred_time','First'));
  raise exception 'Identity forgery was allowed';
 exception when raise_exception then if sqlerrm<>'You can only update your own RSVP' then raise;end if;end;
 begin
  update public.baseline_rsvps set reserve=false where event_id=ev;
  raise exception 'Direct write bypass was allowed';
 exception when insufficient_privilege then null;end;
 begin
  perform public.baseline_submit_rsvp(jsonb_build_object('event_id',ev,'attending',true,'preferred_time','Whenever'));
  raise exception 'Invalid preference accepted';
 exception when raise_exception then if sqlerrm<>'Choose First, Middle or End' then raise;end if;end;
 perform public.baseline_vote((select trip_id from qa_ids),'yes');
 perform public.baseline_vote((select trip_id from qa_ids),'no');
 if (select count(*) from public.baseline_trip_votes where event_id=(select trip_id from qa_ids))<>1 then raise exception 'Trip vote duplicated';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select u2::text from qa_ids),true);
set local role authenticated;
do $$ declare saved jsonb;begin
 saved:=public.baseline_submit_rsvp(jsonb_build_object('event_id',(select event_id from qa_ids),'attending',true,'buggy',false,'preferred_time','Middle'));
 if not (saved->>'reserve')::boolean then raise exception 'Capacity did not send second member to waiting list';end if;
 if (select count(*) from public.baseline_rsvps where event_id=(select event_id from qa_ids))<>2 then raise exception 'Distinct accounts with same name were blocked';end if;
 if exists(select 1 from public.baseline_rsvp_contacts) then raise exception 'Member can read private contacts';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select u1::text from qa_ids),true);
set local role authenticated;
do $$ begin
 perform public.baseline_submit_rsvp(jsonb_build_object('event_id',(select event_id from qa_ids),'attending',false,'buggy',true,'preferred_time','First'));
 if not exists(select 1 from public.baseline_rsvps where user_id=(select u2 from qa_ids) and attending and not reserve) then raise exception 'Waiting member was not promoted';end if;
 if exists(select 1 from public.baseline_rsvps where user_id=(select u1 from qa_ids) and (buggy or preferred_time is not null)) then raise exception 'Not-playing response kept irrelevant preferences';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select organiser::text from qa_ids),true);
set local role authenticated;
do $$ begin
 perform public.baseline_save_tee_times((select event_id from qa_ids),jsonb_build_array(jsonb_build_object('time','09:00','players',jsonb_build_array((select u2 from qa_ids)))));
 if not exists(select 1 from public.baseline_tee_times where event_id=(select event_id from qa_ids)) then raise exception 'Organiser tee publication failed';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select u2::text from qa_ids),true);
set local role authenticated;
do $$ begin
 perform public.baseline_submit_rsvp(jsonb_build_object('event_id',(select event_id from qa_ids),'attending',false));
 if not exists(select 1 from public.baseline_events where id=(select event_id from qa_ids) and tee_times_dirty) then raise exception 'Stale tee times were not flagged';end if;
 begin
  perform public.baseline_save_tee_times((select event_id from qa_ids),'[]'::jsonb);
  raise exception 'Member was able to publish tee times';
 exception when raise_exception then if sqlerrm<>'Organiser access required' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
 begin
  perform public.baseline_submit_rsvp(jsonb_build_object('event_id',(select event_id from qa_ids),'attending',true,'preferred_time','First'));
  raise exception 'Anonymous RSVP was allowed';
 exception when insufficient_privilege then null;end;
 begin perform * from public.baseline_rsvps;raise exception 'Anonymous responses were readable';exception when insufficient_privilege then null;end;
 begin perform * from public.baseline_tee_times;raise exception 'Anonymous tee sheet was readable';exception when insufficient_privilege then null;end;
 perform * from public.baseline_event_counts();
end $$;
reset role;
rollback;
select 'PASS: account creation trigger, repeated RSVP, editing, capacity, same-name members, waiting-list promotion, contact privacy, ownership, signed-out access, trip uniqueness and tee publication. All test records rolled back.' as verification;
