-- Synthetic members only. Every edit, booking and login is rolled back.
begin;
create temp table member_qa(admin uuid,m1 uuid,m2 uuid,m3 uuid,u1 uuid,u2 uuid,event_id bigint,booking_id bigint,requested timestamptz,profile_count bigint);
insert into member_qa select (select id from public.profiles where is_admin limit 1),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,null,null,(select count(*) from public.profiles);
grant select,update on member_qa to authenticated;
create temp table member_score_qa as select gen_random_uuid() as id,'QA Roster Score '||n as name,30+n as points from generate_series(1,3) n;
grant select on member_score_qa to authenticated;
insert into public.baseline_members(id,name) select id,name from member_score_qa;
insert into public.baseline_members(id,name)
select m1,'QA Roster Alpha' from member_qa union all select m2,'QA Roster Bravo' from member_qa union all select m3,'QA Roster Charlie' from member_qa;
with e as (insert into public.baseline_events(name,date,max_players,event_type,round_number,member_price) values('QA member editing',current_date+60,24,'league',1,45) returning id)
update member_qa set event_id=(select id from e);
select set_config('request.jwt.claim.sub',(select admin::text from member_qa),true);
set local role authenticated;
do $$declare q member_qa; saved jsonb; state jsonb; extra record; entries jsonb;begin
 select * into q from member_qa;
 if (select count(*) from public.baseline_admin_members() where id in(q.m1,q.m2,q.m3) and not registered)<>3 then raise exception 'Roster members missing from Admin'; end if;
 perform public.baseline_admin_save_roster_member(q.m1,'QA Roster Alpha Edited','07000000001',20);
 perform public.baseline_admin_save_roster_member(q.m2,'QA Roster Bravo','',25);
 if not exists(select 1 from public.baseline_admin_members() where id=q.m1 and username='QA Roster Alpha Edited' and mobile='07000000001' and handicap=20 and not registered) then raise exception 'Member edit did not persist'; end if;
 begin perform public.baseline_admin_save_roster_member(q.m1,'QA Roster Bravo','07000000001',20);raise exception 'Duplicate name accepted';exception when raise_exception then if sqlerrm<>'That username is already in use' then raise;end if;end;
 begin perform public.baseline_admin_save_roster_member(q.m1,'QA Roster Alpha Edited','invalid',20);raise exception 'Invalid phone accepted';exception when raise_exception then if sqlerrm<>'Enter a valid mobile number or leave it blank' then raise;end if;end;
 begin perform public.baseline_admin_save_roster_member(q.m1,'QA Roster Alpha Edited','',37);raise exception 'Invalid handicap accepted';exception when raise_exception then if sqlerrm<>'Starting handicap must be 0 to 36, with at most one decimal place' then raise;end if;end;
 begin perform * from baseline_private.member_contacts;raise exception 'Private contact table exposed';exception when insufficient_privilege then null;end;
 saved:=public.baseline_submit_rsvp(jsonb_build_object('event_id',q.event_id,'member_id',q.m1,'attending',true,'buggy',true,'preferred_time','End'));
 update member_qa set booking_id=(saved->>'id')::bigint,requested=(select requested_at from public.baseline_rsvps where id=(saved->>'id')::bigint);
 perform public.baseline_save_tee_times(q.event_id,jsonb_build_array(jsonb_build_object('time','09:00','players',jsonb_build_array(q.m1))));
 perform public.baseline_admin_save_roster_member(q.m1,'QA Roster Alpha Final','07000000002',20);
 if not exists(select 1 from public.baseline_rsvps r join member_qa v on r.id=v.booking_id where r.name='QA Roster Alpha Final' and r.requested_at=v.requested and r.attending and r.buggy and r.preferred_time='End' and r.user_id is null) then raise exception 'Editing changed the booking identity or preferences'; end if;
 if not exists(select 1 from public.baseline_tee_times,jsonb_array_elements(players) p where event_id=q.event_id and p->>'name'='QA Roster Alpha Final' and p->>'member_id'=q.m1::text) then raise exception 'Name not synchronized to tee groups'; end if;
 for extra in select * from member_score_qa loop
  perform public.baseline_admin_save_roster_member(extra.id,extra.name,'',20);
  perform public.baseline_submit_rsvp(jsonb_build_object('event_id',q.event_id,'member_id',extra.id,'attending',true));
 end loop;
 select jsonb_agg(jsonb_build_object('user_id',id,'points',points,'status','played')) into entries from member_score_qa;
 state:=public.baseline_league_admin();
 state:=public.baseline_league_save_round(q.event_id,entries||jsonb_build_array(jsonb_build_object('user_id',q.m1,'points',36,'status','played')),null,true,(state->>'revision')::integer);
 perform public.baseline_admin_save_roster_member(q.m1,'QA Roster Alpha Final','07000000002',18);
 begin perform public.baseline_admin_save_roster_member(q.m1,'QA Roster Alpha Final','',null);raise exception 'Published starting handicap cleared';exception when raise_exception then if sqlerrm<>'A player with published scores needs a starting handicap' then raise;end if;end;
end $$;
reset role;
do $$declare q member_qa;begin
 select * into q from member_qa;
 if (select count(*) from public.profiles)<>q.profile_count then raise exception 'Editing fabricated a login';end if;
 if not exists(select 1 from public.baseline_rsvp_contacts where rsvp_id=q.booking_id and phone='07000000002') then raise exception 'Saved phone missing from private RSVP contacts';end if;
 if not exists(select 1 from baseline_private.league_rounds,jsonb_array_elements(results) r where event_id=q.event_id and r->>'user_id'=q.m1::text and (r->>'handicap')::numeric=18 and (r->>'points')::integer=36) then raise exception 'Handicap edit failed to recalculate published results';end if;
end $$;
-- A member's own registration phone takes precedence; booking/name/handicap stay linked.
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,email,raw_user_meta_data,aud,role,created_at,updated_at)
select u1,'qa-roster-'||u1||'@example.invalid',jsonb_build_object('roster_id',m1,'phone','07000000003','name_confirmation',true),'authenticated','authenticated',now(),now() from member_qa;
insert into auth.users(id,email,raw_user_meta_data,aud,role,created_at,updated_at)
select u2,'qa-roster-'||u2||'@example.invalid',jsonb_build_object('roster_id',m2,'phone','07000000004','name_confirmation',true),'authenticated','authenticated',now(),now() from member_qa;
do $$declare q member_qa;begin
 select * into q from member_qa;
 if not exists(select 1 from public.profiles where id=q.u1 and full_name='QA Roster Alpha Final' and handicap=18 and phone='07000000003') then raise exception 'Registration lost edited details';end if;
 if not exists(select 1 from public.profiles where id=q.u2 and handicap=25) then raise exception 'Registration without a booking lost starting handicap';end if;
 if exists(select 1 from baseline_private.member_contacts where member_id in(q.m1,q.m2)) then raise exception 'Stale offline contact retained after registration';end if;
 if not exists(select 1 from public.baseline_rsvps where id=q.booking_id and user_id=q.u1 and member_id=q.m1 and attending and buggy and requested_at=q.requested) then raise exception 'Registration lost booking';end if;
end $$;
select set_config('request.jwt.claim.sub',(select admin::text from member_qa),true);
set local role authenticated;
do $$declare q member_qa;begin
 select * into q from member_qa;
 if (select count(*) from public.baseline_admin_members() where member_id=q.m1)<>1 or not exists(select 1 from public.baseline_admin_members() where id=q.u1 and member_id=q.m1 and registered) then raise exception 'Registration duplicated or hid member';end if;
 begin perform public.baseline_admin_save_roster_member(q.m1,'Stale editor','',18);raise exception 'Stale roster editor overwrote a login';exception when raise_exception then if sqlerrm<>'This member now has a login. Refresh Members before editing' then raise;end if;end;
 perform public.baseline_admin_save_account(q.u1,'QA Roster Alpha Registered','07000000005',18,false);
 if not exists(select 1 from public.baseline_admin_members() where id=q.u1 and username='QA Roster Alpha Registered' and mobile='07000000005') then raise exception 'Existing registered editor broken';end if;
 perform public.baseline_admin_save_roster_member(q.m3,'QA Roster Charlie','07000000006',null);
 perform public.baseline_admin_save_roster_member(q.m3,'QA Roster Charlie','',null);
 if exists(select 1 from public.baseline_admin_members() where id=q.m3 and mobile is not null) then raise exception 'Optional phone could not be cleared';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select u1::text from member_qa),true);
set local role authenticated;
do $$begin
 begin perform * from public.baseline_admin_members();raise exception 'Member can list private member records';exception when raise_exception then if sqlerrm<>'Organiser access required' then raise;end if;end;
 begin perform public.baseline_admin_save_roster_member((select m3 from member_qa),'Forged update','',10);raise exception 'Member can edit another roster member';exception when raise_exception then if sqlerrm<>'Organiser access required' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$begin
 begin perform * from public.baseline_admin_members();raise exception 'Anonymous member listing';exception when insufficient_privilege then null;end;
 begin perform public.baseline_admin_save_roster_member(gen_random_uuid(),'Forged update','',10);raise exception 'Anonymous member edit';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: roster editing, validation, contact privacy, booking and tee identity, score recalculation, later registration with/without booking, stale editor protection and admin-only access; all fixtures rolled back.' as verification;
