begin;
create temp table guest_qa(k text primary key,id uuid,ev bigint);
grant select,insert,update on guest_qa to authenticated;
grant select on guest_qa to anon;
insert into guest_qa(k,id) values('host',gen_random_uuid()),('guest',gen_random_uuid()),('waiter',gen_random_uuid());
insert into public.baseline_members(id,name) select id,'QA Share Host' from guest_qa where k='host';
insert into auth.users(id,email,raw_user_meta_data,aud,role,created_at,updated_at) select id,id||'@example.invalid',jsonb_build_object('roster_id',id,'full_name','QA Share Host','phone','07012345901','name_confirmation',true),'authenticated','authenticated',now(),now() from guest_qa where k='host';
with e as (insert into public.baseline_events(name,date,round_number,max_players,guest_price,member_price,cancellation_terms) values('QA shared guest round','2027-06-25',1,2,45,30,'Cancel by the agreed deadline') returning id) insert into guest_qa(k,ev) select 'event',id from e;
update baseline_private.operations_settings set membership_fee=25;
select set_config('request.jwt.claim.sub',(select id::text from guest_qa where k='host'),true);
set local role authenticated;
select public.baseline_submit_rsvp(jsonb_build_object('event_id',(select ev from guest_qa where k='event'),'attending',true,'accept_terms',true));
insert into guest_qa(k,id) select 'link',(public.baseline_guest_invitations('create',jsonb_build_object('event_id',(select ev from guest_qa where k='event')))->>'token')::uuid;
insert into guest_qa(k,id) select 'link2',(public.baseline_guest_invitations('create',jsonb_build_object('event_id',(select ev from guest_qa where k='event')))->>'token')::uuid;
insert into guest_qa(k,id) select 'revoke',(public.baseline_guest_invitations('create',jsonb_build_object('event_id',(select ev from guest_qa where k='event')))->>'token')::uuid;
select public.baseline_guest_invitations('revoke',jsonb_build_object('token',(select id from guest_qa where k='revoke')));
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$declare d jsonb;begin
 d:=public.baseline_guest_invitations('view',jsonb_build_object('token',(select id from guest_qa where k='link')));
 if d->>'guest_price'<>'45.00' and (d->>'guest_price')::numeric<>45 then raise exception 'Guest price missing';end if;
 if d ? 'phone' or d ? 'bank_instructions' or d ? 'user_id' then raise exception 'Private details leaked in invite preview';end if;
 begin perform public.baseline_guest_invitations('create','{}');raise exception 'Anonymous invite creation allowed';exception when raise_exception then if sqlerrm<>'Sign in with your active account' then raise;end if;end;
end $$;
reset role;
insert into auth.users(id,email,raw_user_meta_data,aud,role,created_at,updated_at)
select id,id||'@example.invalid',jsonb_build_object('guest_token',(select id from guest_qa where k='link'),'full_name','QA Share Guest','phone','07012345902','guest_handicap',29,'guest_price',45,'accept_terms',true,'terms_snapshot','Cancel by the agreed deadline','buggy',true),'authenticated','authenticated',now(),now() from guest_qa where k='guest';
insert into auth.users(id,email,raw_user_meta_data,aud,role,created_at,updated_at)
select id,id||'@example.invalid',jsonb_build_object('guest_token',(select id from guest_qa where k='link2'),'full_name','QA Waiting Guest','phone','07012345903','guest_handicap',24,'guest_price',45,'accept_terms',true,'terms_snapshot','Cancel by the agreed deadline'),'authenticated','authenticated',now(),now() from guest_qa where k='waiter';
do $$declare uid uuid:=(select id from guest_qa where k='guest');begin
 if not exists(select 1 from public.baseline_rsvps where user_id=uid and attending and not reserve and name='QA Share Guest (guest)' and guest_host_id=(select id from guest_qa where k='host')) then raise exception 'Guest not auto-booked with host';end if;
 if not exists(select 1 from baseline_private.charges where user_id=uid and category='guest' and amount=45) then raise exception 'Wrong guest fee';end if;
 if exists(select 1 from baseline_private.charges where user_id in(select id from guest_qa where k in ('guest','waiter')) and scope='membership:2027') then raise exception 'Guest annual fee charged';end if;
 if not exists(select 1 from public.profiles where id=uid and handicap is null) then raise exception 'Self-reported handicap trusted';end if;
 if not exists(select 1 from public.baseline_rsvps where user_id=(select id from guest_qa where k='waiter') and reserve and not attending) then raise exception 'Full event overbooked';end if;
 if exists(select 1 from baseline_private.charges where user_id=(select id from guest_qa where k='waiter')) then raise exception 'Waiting guest charged';end if;
 if exists(select 1 from public.baseline_member_roster() where name='QA Share Guest') then raise exception 'Guest exposed to roster claiming';end if;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from guest_qa where k='guest'),true);
set local role authenticated;
do $$declare d jsonb;begin
 d:=public.baseline_guest_invitations('join',jsonb_build_object('token',(select id from guest_qa where k='link')));
 if d->>'already_joined'<>'true' then raise exception 'Repeat acceptance not idempotent';end if;
 perform public.baseline_submit_rsvp(jsonb_build_object('event_id',(select ev from guest_qa where k='event'),'attending',true,'buggy',false));
 if not exists(select 1 from public.baseline_rsvps where user_id=auth.uid() and name='QA Share Guest (guest)') then raise exception 'RSVP editing removed guest label';end if;
 begin perform public.baseline_guest_invitations('revoke',jsonb_build_object('token',(select id from guest_qa where k='revoke')));raise exception 'Guest revoked host link';exception when raise_exception then if sqlerrm<>'Only an unused invitation can be cancelled' then raise;end if;end;
 begin perform public.baseline_guest_invitations('create',jsonb_build_object('event_id',(select ev from guest_qa where k='event')));raise exception 'Guest spawned invitations';exception when raise_exception then if sqlerrm<>'A society member must invite guests' then raise;end if;end;
 begin perform * from baseline_private.guest_links;raise exception 'Guest read private links';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where is_admin limit 1),true);
set local role authenticated;
do $$declare d jsonb;g uuid;begin
 d:=public.baseline_operations('admin');select (x->>'id')::uuid into g from jsonb_array_elements(d->'guests') x where x->>'name'='QA Share Guest';
 perform public.baseline_guest_invitations('review',jsonb_build_object('id',g,'handicap',28));
 if not exists(select 1 from public.profiles where id=(select id from guest_qa where k='guest') and handicap=28) then raise exception 'Committee approval did not set handicap';end if;
 perform public.baseline_save_tee_times((select ev from guest_qa where k='event'),jsonb_build_array(jsonb_build_object('time','10:00','players',(select jsonb_agg(id) from guest_qa where k in ('host','guest')))));
 d:=public.baseline_event_tee_groups((select ev from guest_qa where k='event'));
 if not exists(select 1 from jsonb_array_elements(d->'groups') grp,jsonb_array_elements(grp->'players') p where p->>'name'='QA Share Guest (guest)' and (p->>'handicap')::numeric=28) then raise exception 'Published group lost guest label or handicap';end if;
end $$;
reset role;
-- Reuse by another identity, stale terms and revoked invitations cannot create bookings.
select set_config('request.jwt.claim.sub',(select id::text from guest_qa where k='waiter'),true);
set local role authenticated;
do $$begin
 begin perform public.baseline_guest_invitations('join',jsonb_build_object('token',(select id from guest_qa where k='link')));raise exception 'Used link was reclaimed';exception when raise_exception then if sqlerrm<>'This invitation has already been used' then raise;end if;end;
 begin perform public.baseline_guest_invitations('join',jsonb_build_object('token',(select id from guest_qa where k='revoke')));raise exception 'Revoked link was accepted';exception when raise_exception then if sqlerrm<>'This invitation is unavailable. Ask your host for a new link' then raise;end if;end;
end $$;
reset role;
with e as(insert into public.baseline_events(name,date,round_number,max_players,guest_price,member_price,cancellation_terms) values('QA return guest round','2027-07-25',2,4,50,35,'New terms') returning id)insert into guest_qa(k,ev)select 'event2',id from e;
select set_config('request.jwt.claim.sub',(select id::text from guest_qa where k='host'),true);
set local role authenticated;
insert into guest_qa(k,id)select 'return',(public.baseline_guest_invitations('create',jsonb_build_object('event_id',(select ev from guest_qa where k='event2')))->>'token')::uuid;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from guest_qa where k='guest'),true);
set local role authenticated;
do $$declare payload jsonb;begin
 payload:=jsonb_build_object('token',(select id from guest_qa where k='return'),'guest_price',45,'guest_handicap',29,'accept_terms',true,'terms_snapshot','New terms');
 begin perform public.baseline_guest_invitations('join',payload);raise exception 'Stale price accepted';exception when raise_exception then if sqlerrm<>'The guest price has changed. Reload the invitation before joining' then raise;end if;end;
 begin perform public.baseline_guest_invitations('join',payload||'{"guest_price":50,"terms_snapshot":"Old terms"}');raise exception 'Stale terms accepted';exception when raise_exception then if sqlerrm<>'Read and accept the current cancellation terms' then raise;end if;end;
 perform public.baseline_guest_invitations('join',payload||'{"guest_price":50}');
 if (select count(*) from public.baseline_rsvps where user_id=auth.uid())<>2 then raise exception 'Returning guest did not join using existing account';end if;
end $$;
reset role;
update public.baseline_events set guest_price=55 where id=(select ev from guest_qa where k='event2');
set local role authenticated;
do $$declare d jsonb;begin
 d:=public.baseline_guest_invitations('mine');
 if not exists(select 1 from jsonb_array_elements(d->'bookings') x where (x->>'event_id')::bigint=(select ev from guest_qa where k='event2') and (x->>'guest_price')::numeric=50) then raise exception 'Advertised price change rewrote booked fee';end if;
end $$;
reset role;
rollback;
select 'PASS: private single-use invites, automatic account/RSVP, guest price, no annual fee, capacity waitlist, idempotence, handicap approval, host link, persistent guest label, published tee groups, returning guests, used/revoked links, stale terms/prices, agreed fee retention, access denials. All fixtures rolled back.' verification;
