-- Synthetic data only; every record and role change rolls back.
begin;
create temp table booking_qa(admin uuid,m1 uuid,m2 uuid,m3 uuid,m4 uuid,u1 uuid,event_id bigint,rsvp_id bigint,requested timestamptz);
insert into booking_qa select (select id from public.profiles where is_admin limit 1),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,null,null;
grant select,update on booking_qa to authenticated;
insert into public.baseline_members(id,name)
select m1,'QA Offline Alpha' from booking_qa union all select m2,'QA Offline Bravo' from booking_qa
union all select m3,'QA Offline Charlie' from booking_qa union all select m4,'QA Offline Delta' from booking_qa;
with e as (insert into public.baseline_events(name,date,max_players,member_price) values('QA offline booking event',current_date+60,1,45) returning id)
update booking_qa set event_id=(select id from e);
select set_config('request.jwt.claim.sub',(select admin::text from booking_qa),true);
set local role authenticated;
do $$declare a jsonb; b jsonb; ev bigint:=(select event_id from booking_qa);begin
 if (select count(*) from public.baseline_admin_booking_members(ev) where id in(select m1 from booking_qa union select m2 from booking_qa))<>2 then raise exception 'Admin cannot list unregistered members'; end if;
 a:=public.baseline_submit_rsvp(jsonb_build_object('event_id',ev,'member_id',(select m1 from booking_qa),'attending',true,'buggy',true,'preferred_time','End'));
 b:=public.baseline_submit_rsvp(jsonb_build_object('event_id',ev,'member_id',(select m1 from booking_qa),'attending',true,'buggy',true,'preferred_time','End'));
 if a->>'id'<>b->>'id' or not (a->>'attending')::boolean or (a->>'reserve')::boolean then raise exception 'Repeated add duplicated or lost confirmed place'; end if;
 update booking_qa set rsvp_id=(a->>'id')::bigint,requested=(select requested_at from public.baseline_rsvps where id=(a->>'id')::bigint);
 b:=public.baseline_submit_rsvp(jsonb_build_object('event_id',ev,'member_id',(select m2 from booking_qa),'attending',true));
 if not (b->>'reserve')::boolean then raise exception 'Offline booking bypassed capacity'; end if;
 if (select playing from public.baseline_event_counts() where event_id=ev)<>1 or (select waiting from public.baseline_event_counts() where event_id=ev)<>1 then raise exception 'Offline places not counted'; end if;
 perform public.baseline_save_tee_times(ev,jsonb_build_array(jsonb_build_object('time','09:00','players',jsonb_build_array((select m1 from booking_qa)))));
 a:=public.baseline_event_tee_groups(ev);
 if a->'groups'->0->'players'->0->>'name'<>'QA Offline Alpha' then raise exception 'Offline player missing from member tee view'; end if;
 perform public.baseline_submit_rsvp(jsonb_build_object('event_id',ev,'member_id',(select m1 from booking_qa),'attending',false));
 if not exists(select 1 from public.baseline_rsvps where event_id=ev and member_id=(select m2 from booking_qa) and attending and not reserve) then raise exception 'Waiting member not promoted'; end if;
 if not (select tee_times_dirty from public.baseline_events where id=ev) then raise exception 'Withdrawal did not flag tees for review'; end if;
 perform public.baseline_submit_rsvp(jsonb_build_object('event_id',ev,'member_id',(select m1 from booking_qa),'attending',true,'buggy',true,'preferred_time','End'));
 begin
  perform public.baseline_submit_rsvp(jsonb_build_object('event_id',ev,'member_id',gen_random_uuid(),'attending',true));
  raise exception 'Unknown member accepted';
 exception when raise_exception then if sqlerrm<>'Choose a member from the list' then raise; end if; end;
end $$;
reset role;
-- A capacity increase promotes the same offline queue, and published tees work.
-- Temporarily hide any existing round one in this rollback-only fixture.
-- Stop instead of displacing real results if this test environment is no longer empty.
do $$begin if exists(select 1 from baseline_private.league_rounds where round_number=1) then raise exception 'Run this fixture on a database without round-one scores'; end if; end $$;
update public.baseline_events set round_number=null where round_number=1;
update public.baseline_events set max_players=4,round_number=1 where id=(select event_id from booking_qa);
set local role authenticated;
do $$declare ev bigint:=(select event_id from booking_qa); state jsonb;begin
 perform public.baseline_submit_rsvp(jsonb_build_object('event_id',ev,'member_id',(select m3 from booking_qa),'attending',true,'buggy',true));
 perform public.baseline_submit_rsvp(jsonb_build_object('event_id',ev,'member_id',(select m4 from booking_qa),'attending',true));
 perform public.baseline_save_tee_times(ev,jsonb_build_array(jsonb_build_object('time','09:00','players',(select jsonb_build_array(m1,m2,m3,m4) from booking_qa))));
 if jsonb_array_length(public.baseline_event_tee_groups(ev)->'groups'->0->'players')<>4 then raise exception 'Manual tee group lost players'; end if;
 state:=public.baseline_league_admin();
 state:=public.baseline_league_save_handicaps((select jsonb_build_array(jsonb_build_object('user_id',m1,'handicap',20),jsonb_build_object('user_id',m2,'handicap',21),jsonb_build_object('user_id',m3,'handicap',22),jsonb_build_object('user_id',m4,'handicap',23)) from booking_qa),(state->>'revision')::integer);
 state:=public.baseline_league_save_round(ev,(select jsonb_build_array(jsonb_build_object('user_id',m1,'points',36,'status','played'),jsonb_build_object('user_id',m2,'points',35,'status','played'),jsonb_build_object('user_id',m3,'points',34,'status','played'),jsonb_build_object('user_id',m4,'points',33,'status','played')) from booking_qa),null,true,(state->>'revision')::integer);
 if not exists(select 1 from jsonb_array_elements(public.baseline_league_board()->'players') x where x->>'id'=(select m1::text from booking_qa)) then raise exception 'Offline player missing from leaderboard'; end if;
 update booking_qa set requested=(select requested_at from public.baseline_rsvps where id=booking_qa.rsvp_id);
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
-- Registration claims the same booking and migrates existing tee/scoring identity.
insert into auth.users(id,email,raw_user_meta_data,aud,role,created_at,updated_at)
select u1,'qa-offline-'||u1||'@example.invalid',jsonb_build_object('roster_id',m1,'phone','07000000001','name_confirmation',true),'authenticated','authenticated',now(),now() from booking_qa;
do $$declare q booking_qa;begin
 select * into q from booking_qa;
 if (select count(*) from public.baseline_rsvps where event_id=q.event_id and (user_id=q.u1 or member_id=q.m1))<>1 then raise exception 'Registration duplicated or lost booking'; end if;
 if not exists(select 1 from public.baseline_rsvps where id=q.rsvp_id and user_id=q.u1 and member_id=q.m1 and attending and buggy and preferred_time='End' and requested_at=q.requested) then raise exception 'Registration did not preserve booking details'; end if;
 if not exists(select 1 from public.baseline_tee_times,jsonb_array_elements(players) p where event_id=q.event_id and p->>'user_id'=q.u1::text) then raise exception 'Registration lost tee assignment'; end if;
 if not exists(select 1 from baseline_private.league_rounds,jsonb_array_elements(results) p where event_id=q.event_id and p->>'user_id'=q.u1::text and (p->>'points')::integer=36) then raise exception 'Registration lost existing score'; end if;
 if not exists(select 1 from public.profiles where id=q.u1 and handicap=20) then raise exception 'Starting handicap not transferred'; end if;
 if not exists(select 1 from baseline_private.charges where user_id=q.u1 and event_id=q.event_id and amount=45) then raise exception 'Registered booking has no charge'; end if;
end $$;
select set_config('request.jwt.claim.sub',(select u1::text from booking_qa),true);
set local role authenticated;
do $$declare ev bigint:=(select event_id from booking_qa);begin
 begin
  perform * from public.baseline_admin_booking_members(ev);raise exception 'Member could use admin roster';
 exception when raise_exception then if sqlerrm<>'Organiser access required' then raise;end if;end;
 begin
  perform public.baseline_submit_rsvp(jsonb_build_object('event_id',ev,'member_id',(select m2 from booking_qa),'attending',true));raise exception 'Member forged another roster booking';
 exception when raise_exception then if sqlerrm<>'Organiser access required' then raise;end if;end;
 begin
  perform public.baseline_submit_rsvp(jsonb_build_object('event_id',ev,'attending',false));raise exception 'Published tee lock bypassed';
 exception when raise_exception then if sqlerrm<>'If you need to withdraw from the event please contact the committee' then raise;end if;end;
 begin
  update public.baseline_rsvps set user_id=(select u1 from booking_qa) where member_id=(select m2 from booking_qa);raise exception 'Direct write bypass';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Registered self-service updates reuse the admin-created RSVP.
update public.baseline_events set tee_published_at=null where id=(select event_id from booking_qa);
set local role authenticated;
do $$declare a jsonb;begin
 a:=public.baseline_submit_rsvp(jsonb_build_object('event_id',(select event_id from booking_qa),'attending',true,'buggy',false));
 if (a->>'id')::bigint<>(select rsvp_id from booking_qa) then raise exception 'Self-service did not reuse admin booking'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$begin
 begin perform * from public.baseline_admin_booking_members(1);raise exception 'Anonymous admin access';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: admin-only booking, duplicate protection, capacity and promotion, member tee view, offline scores, registration inheritance, ownership and published-tee locks; all synthetic data rolled back.' as verification;
