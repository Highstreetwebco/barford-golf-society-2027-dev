-- Synthetic fixtures, tested against the current schema; no writes survive.
begin;
create temp table guest_flow_qa(host uuid,event_id bigint,token uuid,token2 uuid,token3 uuid,guest uuid,guest2 uuid,snapshot jsonb,payload jsonb,auth_count int);
grant select,update on guest_flow_qa to authenticated,service_role;
insert into guest_flow_qa(host,auth_count) select (select id from public.profiles where is_admin limit 1),(select count(*) from auth.users);
with ev as(insert into public.baseline_events(name,date,max_players,member_price,guest_price,cancellation_terms,round_number) values('QA account-free guest golf',(now() at time zone 'Europe/London')::date+30,2,30,45,'QA cancellation terms',1) returning id) update guest_flow_qa set event_id=(select id from ev);
select set_config('request.jwt.claim.sub',(select host::text from guest_flow_qa),true);
set local role authenticated;
select public.baseline_submit_rsvp(jsonb_build_object('event_id',(select event_id from guest_flow_qa),'attending',true,'accept_terms',true));
update guest_flow_qa set token=(public.baseline_guest_invitations('create',jsonb_build_object('event_id',event_id))->>'token')::uuid;
update guest_flow_qa set token2=(public.baseline_guest_invitations('create',jsonb_build_object('event_id',event_id))->>'token')::uuid;
update guest_flow_qa set token3=(public.baseline_guest_invitations('create',jsonb_build_object('event_id',event_id))->>'token')::uuid;
do $$begin
 if has_function_privilege('anon','public.baseline_guest_rsvp(text,jsonb)','execute') or has_function_privilege('authenticated','public.baseline_guest_rsvp(text,jsonb)','execute') or has_function_privilege('authenticated','baseline_private.guest_rsvp(text,jsonb,boolean)','execute') then raise exception 'Capability backend exposed to browser roles';end if;
 begin perform public.baseline_guest_invitations('create',jsonb_build_object('event_id',(select event_id from guest_flow_qa)));raise exception 'Fourth guest invitation allowed';exception when raise_exception then if sqlerrm not like 'A fourball%' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
update guest_flow_qa set snapshot=public.baseline_guest_rsvp('view',jsonb_build_object('token',token));
update guest_flow_qa set payload=jsonb_build_object('token',token,'host_id',host,'revision',0,'full_name','QA Visiting Golfer','phone','07012345001','email','guest@example.invalid','guest_handicap',25.5,'attending',true,'buggy',false,'guest_price',45,'accept_terms',true,'terms_snapshot','QA cancellation terms');
do $$declare q guest_flow_qa; d jsonb;begin
 select * into q from guest_flow_qa;
 if q.snapshot->>'editable'<>'true' or q.snapshot->>'full_name' is not null then raise exception 'Initial view incorrect';end if;
 begin perform public.baseline_guest_rsvp('save',q.payload||jsonb_build_object('host_id',gen_random_uuid()));raise exception 'Inviter spoof allowed';exception when raise_exception then if sqlerrm<>'Confirm the member named on this invitation' then raise;end if;end;
 begin perform public.baseline_guest_rsvp('save',q.payload||'{"guest_price":40}');raise exception 'Stale price accepted';exception when raise_exception then if sqlerrm<>'The guest price changed. Reload the invitation' then raise;end if;end;
 begin perform public.baseline_guest_rsvp('save',q.payload||'{"terms_snapshot":"Old terms"}');raise exception 'Stale terms accepted';exception when raise_exception then if sqlerrm<>'Read and accept the current cancellation terms' then raise;end if;end;
 d:=public.baseline_guest_rsvp('save',q.payload);
 if d->>'attending'<>'true' or d->>'reserve'<>'false' then raise exception 'Guest not confirmed';end if;
 update guest_flow_qa set snapshot=d,guest=(d->>'member_id')::uuid;
 begin perform public.baseline_guest_rsvp('save',q.payload);raise exception 'Stale form allowed';exception when raise_exception then if sqlerrm<>'This RSVP changed. Reload the invitation before saving' then raise;end if;end;
 begin perform public.baseline_guest_rsvp('save',q.payload||jsonb_build_object('token',q.token2));raise exception 'Duplicate booking allowed';exception when raise_exception then if sqlerrm not like 'A booking already uses%' then raise;end if;end;
 d:=public.baseline_guest_rsvp('save',q.payload||jsonb_build_object('token',q.token2,'phone','07012345002'));
 if d->>'reserve'<>'true' or d->>'attending'<>'false' then raise exception 'Capacity/waitlist failed';end if;
 update guest_flow_qa set guest2=(d->>'member_id')::uuid;
end $$;
reset role;
do $$declare q guest_flow_qa;begin
 select * into q from guest_flow_qa;
 if (select count(*) from auth.users)<>q.auth_count then raise exception 'Guest created an Auth account';end if;
 if not exists(select 1 from public.baseline_rsvps where member_id=q.guest and user_id is null and name='QA Visiting Golfer (guest)' and guest_host_id=q.host) then raise exception 'Guest roster identity failed';end if;
 if (select count(*) from public.baseline_members where name='QA Visiting Golfer' and invite_only)<>2 then raise exception 'Different guests with same name cannot join';end if;
 if exists(select 1 from baseline_private.charges where user_id in(q.guest,q.guest2)) then raise exception 'Synthetic account charge created';end if;
 insert into storage.objects(bucket_id,name) values('baseline-profile-images',q.guest||'/20000000-0000-4000-8000-000000000001.jpg');
end $$;
set local role service_role;
select public.baseline_guest_rsvp('photo_save',jsonb_build_object('token',token,'photo_path',guest||'/20000000-0000-4000-8000-000000000001.jpg','expected_path',null)) from guest_flow_qa;
reset role;
select set_config('request.jwt.claim.sub',(select host::text from guest_flow_qa),true);
set local role authenticated;
do $$declare q guest_flow_qa;d jsonb;begin
 select * into q from guest_flow_qa;
 begin perform public.baseline_save_tee_times(q.event_id,jsonb_build_array(jsonb_build_object('time','09:00','players',jsonb_build_array(q.host)),jsonb_build_object('time','09:10','players',jsonb_build_array(q.guest))));raise exception 'Split host accepted';exception when raise_exception then if sqlerrm not like 'Keep every guest%' then raise;end if;end;
 perform public.baseline_save_tee_times(q.event_id,jsonb_build_array(jsonb_build_object('time','09:00','players',jsonb_build_array(q.host,q.guest))));
 d:=public.baseline_event_tee_groups(q.event_id);
 if not exists(select 1 from jsonb_array_elements(d->'groups'->0->'players') p where p->>'participant_id'=q.guest::text and p->>'name'='QA Visiting Golfer (guest)' and p->>'avatar_path'=q.guest||'/20000000-0000-4000-8000-000000000001.jpg') then raise exception 'Guest photo/name missing in tee group';end if;
 d:=public.baseline_guest_invitations('mine',jsonb_build_object('event_id',q.event_id));
 if not exists(select 1 from jsonb_array_elements(d->'links') l where l->>'token'=q.token::text and l->>'claimed'='true') then raise exception 'Host cannot see joined guest';end if;
 begin perform public.baseline_guest_invitations('revoke',jsonb_build_object('token',q.token));raise exception 'Used invitation revoked';exception when raise_exception then if sqlerrm<>'Only an unused invitation can be cancelled' then raise;end if;end;
 perform public.baseline_admin_member_photo(q.guest);
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
do $$declare q guest_flow_qa; d jsonb;begin
 select * into q from guest_flow_qa;
 d:=public.baseline_guest_rsvp('view',jsonb_build_object('token',q.token));
 if d->>'tee_time'<>'09:00' then raise exception 'Guest personal tee time absent';end if;
 d:=public.baseline_guest_rsvp('save',q.payload||jsonb_build_object('revision',d->'revision','attending',false,'accept_terms',false));
 if d->>'attending'<>'false' or d->>'reserve'<>'false' then raise exception 'Withdrawal failed';end if;
end $$;
reset role;
do $$declare q guest_flow_qa;begin
 select * into q from guest_flow_qa;
 if not exists(select 1 from public.baseline_rsvps where member_id=q.guest2 and attending and not reserve) then raise exception 'Withdrawal did not promote waitlist';end if;
 if not (select tee_times_dirty from public.baseline_events where id=q.event_id) then raise exception 'Published tees not marked for review';end if;
 update public.baseline_events set date=(now() at time zone 'Europe/London')::date+10 where id=q.event_id;
end $$;
set local role service_role;
do $$declare q guest_flow_qa;d jsonb;begin
 select * into q from guest_flow_qa;
 d:=public.baseline_guest_rsvp('view',jsonb_build_object('token',q.token));
 if d->>'editable'<>'false' then raise exception 'Day 10 still editable';end if;
 begin perform public.baseline_guest_rsvp('save',q.payload||jsonb_build_object('revision',d->'revision'));raise exception 'Cutoff bypass allowed';exception when raise_exception then if sqlerrm not like 'Online guest changes close 10 days%' then raise;end if;end;
 begin perform public.baseline_guest_rsvp('photo_check',jsonb_build_object('token',q.token));raise exception 'Late guest photo change allowed';exception when raise_exception then if sqlerrm not like 'Online guest changes close 10 days%' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select host::text from guest_flow_qa),true);
set local role authenticated;
do $$declare q guest_flow_qa;d jsonb;begin
 select * into q from guest_flow_qa;
 d:=public.baseline_admin_guest_rsvp('view',jsonb_build_object('member_id',q.guest,'event_id',q.event_id));
 d:=public.baseline_admin_guest_rsvp('save',q.payload||jsonb_build_object('member_id',q.guest,'event_id',q.event_id,'revision',d->'revision','full_name','QA Renamed Guest','phone','07012345003','attending',false));
 if d->>'full_name'<>'QA Renamed Guest' then raise exception 'Admin late edit failed';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$begin
 begin perform public.baseline_admin_guest_rsvp('view','{}');raise exception 'Anonymous admin endpoint access';exception when insufficient_privilege then null;end;
 begin perform public.baseline_guest_rsvp('view','{}');raise exception 'Anonymous backend endpoint access';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS guest RSVP: no Auth accounts; isolated bearer bookings; private contacts; same-name guests; host confirmation; terms/price/revision guards; capacity, waitlist and withdrawal; portraits; hard tee pairing; published-sheet invalidation; server 10-day cutoff; late admin edits and role denials. Fixtures rolled back.' verification;
