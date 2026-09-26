begin;
create temp table qa_tee(member uuid,other uuid,admin uuid);
insert into qa_tee values(gen_random_uuid(),gen_random_uuid(),(select id from public.profiles where is_admin limit 1));
grant select on qa_tee to authenticated,anon;
insert into public.baseline_members(id,name) select member,'QA Portrait One' from qa_tee union all select other,'QA Portrait Two' from qa_tee;
insert into auth.users(id,email,raw_user_meta_data,aud,role,created_at,updated_at)
select id,'qa-'||id||'@example.invalid',jsonb_build_object('roster_id',id,'phone','07000000001','name_confirmation',true),'authenticated','authenticated',now(),now() from (select member id from qa_tee union all select other from qa_tee) t;
select set_config('request.jwt.claim.sub',(select admin::text from qa_tee),true);
update public.profiles set handicap=20 where id in(select member from qa_tee union all select other from qa_tee);
insert into public.baseline_events(name,date,round_number) values('QA First','2027-03-01',1),('QA Tee Event','2027-04-01',2),('QA Secret Result','2027-08-01',6),('QA Secret Handicap','2027-09-01',7);
insert into baseline_private.league_rounds(event_id,round_number,published_entries,results) select id,round_number,'[]'::jsonb,jsonb_build_array(jsonb_build_object('user_id',(select member from qa_tee),'next_handicap',case when round_number=1 then 17.5 else 3 end)) from public.baseline_events where round_number in(1,6);
insert into public.baseline_tee_times(event_id,group_number,tee_time,players) select id,1,'09:24',jsonb_build_array(jsonb_build_object('user_id',(select member from qa_tee),'name','Untrusted old name','type','buggy'),jsonb_build_object('user_id',(select other from qa_tee),'name','Other','type','walker')) from public.baseline_events where round_number in(2,7);
-- Storage metadata fixtures only: rolled back, no remote files uploaded.
insert into storage.objects(bucket_id,name,owner_id) select 'baseline-profile-images',member||'/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg',member::text from qa_tee union all select 'baseline-profile-images',other||'/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg',other::text from qa_tee;
select set_config('request.jwt.claim.sub',(select member::text from qa_tee),true);
set local role authenticated;
do $$declare answer jsonb;begin
 update public.profiles set baseline_avatar_path=id||'/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg' where id=auth.uid();
 begin update public.profiles set baseline_avatar_path=(select other::text||'/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg' from qa_tee) where id=auth.uid();raise exception 'Other member photo accepted';exception when raise_exception then if sqlerrm<>'Upload your own profile photo before saving it' then raise;end if;end;
 answer:=public.baseline_event_tee_groups((select id from public.baseline_events where round_number=2));
 if answer->>'status'<>'published' or answer#>>'{groups,0,players,0,name}'<>'QA Portrait One' or (answer#>>'{groups,0,players,0,handicap}')::numeric<>17.5 then raise exception 'Published name/round handicap incorrect';end if;
 if answer#>>'{groups,0,players,0,avatar_path}' is null then raise exception 'Photo path missing';end if;
 if answer::text like '%07000000001%' or answer::text like '%example.invalid%' then raise exception 'Contact data leaked';end if;
 answer:=public.baseline_event_tee_groups((select id from public.baseline_events where round_number=7));
 if answer#>>'{groups,0,players,0,handicap}' is not null or answer#>>'{groups,0,players,0,handicap_secret}'<>'true' then raise exception 'Secret round adjustment leaked via next-round tee group';end if;
 if (select count(*) from storage.objects where bucket_id='baseline-profile-images')<>2 then raise exception 'Active members cannot read portraits';end if;
 begin insert into storage.objects(bucket_id,name) values('baseline-profile-images',(select other::text||'/cccccccc-cccc-cccc-cccc-cccccccccccc.jpg' from qa_tee));raise exception 'Cross-member upload allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select admin::text from qa_tee),true);
set local role authenticated;
do $$declare answer jsonb;begin
 answer:=public.baseline_event_tee_groups((select id from public.baseline_events where round_number=7));
 if (answer#>>'{groups,0,players,0,handicap}')::numeric<>3 then raise exception 'Admin secret handicap inaccessible';end if;
 update public.baseline_events set tee_times_dirty=true where round_number=2;
 answer:=public.baseline_event_tee_groups((select id from public.baseline_events where round_number=2));
 if answer->>'status'<>'reviewing' or jsonb_array_length(answer->'groups')<>0 then raise exception 'Stale tee groups leaked';end if;
end $$;
reset role;
set local role anon;
do $$begin
 if exists(select 1 from storage.objects where bucket_id='baseline-profile-images') then raise exception 'Anonymous can read portraits';end if;
 begin perform public.baseline_event_tee_groups(1);raise exception 'Anonymous group RPC allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.baseline_member_accounts set disabled=true where user_id=(select member from qa_tee);
select set_config('request.jwt.claim.sub',(select member::text from qa_tee),true);
set local role authenticated;
do $$begin
 if exists(select 1 from storage.objects where bucket_id='baseline-profile-images') then raise exception 'Disabled member can read portraits';end if;
 begin perform public.baseline_event_tee_groups(1);raise exception 'Disabled account allowed';exception when raise_exception then if sqlerrm<>'Member sign-in required' then raise;end if;end;
end $$;
reset role;
rollback;
select 'PASS: private portraits, owner-only upload and profile path validation, active members only, exact round handicap, authoritative names, no contact data, secret R7 handicap suppression, admin visibility and stale-group suppression. All fixtures rolled back.' verification;
