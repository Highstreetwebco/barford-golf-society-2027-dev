-- Isolated storage metadata and synthetic members; nothing survives rollback.
begin;
create temp table portrait_qa(admin uuid,m1 uuid,m2 uuid,u1 uuid,path1 text,path2 text,other_path text,event_id bigint);
insert into portrait_qa select (select id from public.profiles where is_admin limit 1),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,null,null,null;
update portrait_qa set path1=m1||'/'||gen_random_uuid()||'.jpg',path2=m1||'/'||gen_random_uuid()||'.jpg',other_path=m2||'/'||gen_random_uuid()||'.jpg';
grant select,update on portrait_qa to authenticated;
insert into public.baseline_members(id,name) select m1,'QA Portrait Alpha' from portrait_qa union all select m2,'QA Portrait Bravo' from portrait_qa;
with ev as (insert into public.baseline_events(name,date,max_players) values('QA portrait groups',current_date+60,24) returning id)
update portrait_qa set event_id=(select id from ev);
select set_config('request.jwt.claim.sub',(select admin::text from portrait_qa),true);
set local role authenticated;
do $$declare q portrait_qa; view jsonb;begin
 select * into q from portrait_qa;
 insert into storage.objects(bucket_id,name) values('baseline-profile-images',q.path1),('baseline-profile-images',q.path2),('baseline-profile-images',q.other_path);
 if public.baseline_admin_member_photo(q.m1)->>'upload_folder'<>q.m1::text then raise exception 'Incorrect unregistered upload folder';end if;
 perform public.baseline_admin_save_member_photo(q.m1,q.path1,null);
 if public.baseline_admin_member_photo(q.m1)->>'avatar_path'<>q.path1 then raise exception 'Offline portrait not saved';end if;
 begin perform public.baseline_admin_save_member_photo(q.m1,q.other_path,q.path1);raise exception 'Cross-member photo accepted';exception when raise_exception then if sqlerrm<>'Upload a photo for this member first' then raise;end if;end;
 begin perform public.baseline_admin_save_member_photo(q.m1,q.m1||'/'||gen_random_uuid()||'.jpg',q.path1);raise exception 'Missing upload accepted';exception when raise_exception then if sqlerrm<>'Upload a photo for this member first' then raise;end if;end;
 perform public.baseline_admin_save_member_photo(q.m1,q.path2,q.path1);
 begin perform public.baseline_admin_save_member_photo(q.m1,null,q.path1);raise exception 'Stale removal overwrote a replacement';exception when raise_exception then if sqlerrm<>'This photo changed. Reopen the photo editor before saving' then raise;end if;end;
 perform public.baseline_admin_save_member_photo(q.m2,q.other_path,null);
 perform public.baseline_submit_rsvp(jsonb_build_object('event_id',q.event_id,'member_id',q.m1,'attending',true));
 perform public.baseline_submit_rsvp(jsonb_build_object('event_id',q.event_id,'member_id',q.m2,'attending',true));
 perform public.baseline_save_tee_times(q.event_id,jsonb_build_array(jsonb_build_object('time','09:00','players',jsonb_build_array(q.m1,q.m2))));
 view:=public.baseline_event_tee_groups(q.event_id);
 if not exists(select 1 from jsonb_array_elements(view->'groups'->0->'players') p where p->>'participant_id'=q.m1::text and p->>'avatar_path'=q.path2) then raise exception 'First offline portrait absent from tee group';end if;
 if not exists(select 1 from jsonb_array_elements(view->'groups'->0->'players') p where p->>'participant_id'=q.m2::text and p->>'avatar_path'=q.other_path) then raise exception 'Second offline portrait absent from tee group';end if;
 begin perform * from baseline_private.member_portraits;raise exception 'Private references exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,email,raw_user_meta_data,aud,role,created_at,updated_at)
select u1,'qa-portrait-'||u1||'@example.invalid',jsonb_build_object('roster_id',m1,'phone','07000000001','name_confirmation',true),'authenticated','authenticated',now(),now() from portrait_qa;
do $$declare q portrait_qa;begin
 select * into q from portrait_qa;
 if not exists(select 1 from public.profiles where id=q.u1 and baseline_avatar_path=q.path2) then raise exception 'Registration lost organiser-added photo';end if;
 if exists(select 1 from baseline_private.member_portraits where member_id=q.m1) then raise exception 'Registration retained a stale portrait reference';end if;
end $$;
select set_config('request.jwt.claim.sub',(select u1::text from portrait_qa),true);
set local role authenticated;
do $$declare q portrait_qa;begin
 select * into q from portrait_qa;
 if (select count(*) from storage.objects where name in(q.path2,q.other_path))<>2 then raise exception 'Active member cannot view group portraits';end if;
 begin perform public.baseline_admin_member_photo(q.m2);raise exception 'Non-admin can inspect admin photo state';exception when raise_exception then if sqlerrm<>'Organiser access required' then raise;end if;end;
 begin perform public.baseline_admin_save_member_photo(q.m2,null,q.other_path);raise exception 'Non-admin can change another portrait';exception when raise_exception then if sqlerrm<>'Organiser access required' then raise;end if;end;
 begin insert into storage.objects(bucket_id,name) values('baseline-profile-images',q.m2||'/'||gen_random_uuid()||'.jpg');raise exception 'Non-admin can upload for another member';exception when insufficient_privilege then null;end;
 begin update public.profiles set baseline_avatar_path=q.other_path where id=q.u1;raise exception 'Profile guard accepted another portrait';exception when raise_exception then if sqlerrm<>'Upload your own profile photo before saving it' then raise;end if;end;
 delete from storage.objects where name=q.other_path;
 if not exists(select 1 from storage.objects where name=q.other_path) then raise exception 'Member deleted another portrait';end if;
 update public.profiles set baseline_avatar_path=null where id=q.u1;
 delete from storage.objects where name=q.path2;
 if exists(select 1 from storage.objects where name=q.path2) then raise exception 'Member cannot remove their inherited portrait';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select admin::text from portrait_qa),true);
set local role authenticated;
do $$declare q portrait_qa; registered_path text;begin
 select * into q from portrait_qa;
 registered_path:=q.u1||'/'||gen_random_uuid()||'.jpg';
 insert into storage.objects(bucket_id,name) values('baseline-profile-images',registered_path);
 perform public.baseline_admin_save_member_photo(q.m1,registered_path,null);
 if public.baseline_admin_member_photo(q.m1)->>'avatar_path'<>registered_path then raise exception 'Registered portrait edit failed';end if;
 perform public.baseline_admin_save_member_photo(q.m1,null,registered_path);
 perform public.baseline_admin_save_member_photo(q.m2,null,q.other_path);
 delete from storage.objects where name in(registered_path,q.path1,q.other_path);
 if exists(select 1 from storage.objects where name in(registered_path,q.path1,q.other_path)) then raise exception 'Admin cleanup blocked';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$begin
 if exists(select 1 from storage.objects where bucket_id='baseline-profile-images') then raise exception 'Portrait bucket is publicly readable';end if;
 begin perform public.baseline_admin_member_photo(gen_random_uuid());raise exception 'Anonymous photo API access';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: private storage policies, registered/unregistered photo changes, tee groups, registration inheritance, cross-member and stale-edit protection, cleanup and non-admin rejection.' as verification;
