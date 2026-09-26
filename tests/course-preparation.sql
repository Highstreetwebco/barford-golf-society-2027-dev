-- 2027 development only; no test records survive this transaction.
begin;
do $$declare admin_id uuid;member_id uuid:=gen_random_uuid();roster_id uuid;begin
 select p.id into admin_id from public.profiles p join public.baseline_member_accounts a on a.user_id=p.id where p.is_admin and not a.disabled limit 1;
 select m.id into roster_id from public.baseline_members m where not invite_only and not exists(select 1 from public.baseline_member_accounts a where a.member_id=m.id) limit 1;
 if admin_id is null or roster_id is null then raise exception 'An active admin and unclaimed roster entry are required';end if;
 insert into auth.users(id,email,raw_user_meta_data) values(member_id,'transaction-course-prep@example.invalid',jsonb_build_object('full_name','Transaction course prep','playing_category','men','phone','07700900123','roster_id',roster_id,'name_confirmation',true));
 perform set_config('barford.prep.member',member_id::text,true);
 perform set_config('barford.prep.admin',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
end $$;
set local role authenticated;
do $$declare item jsonb;saved jsonb;response jsonb;legacy jsonb;eid bigint;bad jsonb;rejected boolean;path text;begin
 item:=public.baseline_course_layout('save','{"name":"Course Preparation Test Golf Club","tee_name":"Yellow","place_id":"transactional-google-place","center":{"lat":52,"lng":-1},"address":"Test address","source":{"provider":"openstreetmap","attribution":"© OpenStreetMap contributors","url":"https://www.openstreetmap.org/copyright","scorecards":[{"tee_name":"Yellow","holes":[]}]},"holes":[{"number":1,"tee":{"lat":52,"lng":-1},"green":{"lat":52.001,"lng":-1.001},"reviewed":true}]}');
 if item->>'place_id'<>'transactional-google-place' or item#>>'{center,lat}'<>'52' or item#>>'{source,scorecards,0,tee_name}'<>'Yellow' then raise exception 'Course metadata did not persist';end if;
 perform set_config('barford.prep.layout',item->>'id',true);
 response:=public.baseline_course_layout('match','{"place_id":"transactional-google-place","name":"Different text","latitude":0,"longitude":0}');
 if jsonb_array_length(response->'layouts')<>1 or response#>>'{layouts,0,match_quality}'<>'place' then raise exception 'Exact course place matching failed';end if;
 response:=public.baseline_course_layout('match','{"place_id":"another-place","name":"Course Preparation Test Golf Club","latitude":52,"longitude":-1}');
 if jsonb_array_length(response->'layouts')<>0 then raise exception 'Different known venue was matched by proximity';end if;
 saved:=public.baseline_course_layout('save',(item-'place_id'-'center'-'source'-'address')||'{"name":"Course Preparation Test"}');
 if saved->>'place_id'<>'transactional-google-place' or saved#>>'{source,provider}'<>'openstreetmap' or saved#>>'{holes,0,reviewed}'<>'true' then raise exception 'Ordinary hole edit lost metadata or reviewed correction';end if;
 for bad in select * from jsonb_array_elements('[{"center":{"lat":91,"lng":0}},{"center":{"lat":"52","lng":0}},{"source":{"url":"javascript:alert(1)"}},{"place_id":""},{"source":[]}]'::jsonb) loop
  rejected:=false;begin perform public.baseline_course_layout('save',saved||bad);exception when others then rejected:=true;end;
  if not rejected then raise exception 'Invalid course metadata was accepted: %',bad;end if;
 end loop;
 insert into public.baseline_events(name,date,event_type,course_layout_id) values('Course prep transaction',current_date,'pairs',(item->>'id')::uuid) returning id into eid;
 perform set_config('barford.prep.event',eid::text,true);
 select value into legacy from jsonb_array_elements(public.baseline_course_layout('list')->'legacy') limit 1;
 if legacy is not null then
  response:=public.baseline_course_layout('match',jsonb_build_object('name',legacy->>'name','latitude',legacy#>'{center,lat}','longitude',legacy#>'{center,lng}'));
  if not exists(select 1 from jsonb_array_elements(response->'legacy') l where l->>'id'=legacy->>'id') then raise exception 'Legacy course could not be matched by name and nearby location';end if;
  response:=public.baseline_course_layout('import',jsonb_build_object('legacy_id',legacy->>'id','place_id','legacy-transaction-place'));
  saved:=public.baseline_course_layout('import',jsonb_build_object('legacy_id',legacy->>'id','place_id','different-import-place'));
  if response->>'id'<>saved->>'id' or saved->>'place_id'<>'legacy-transaction-place' then raise exception 'Repeat import reassigned course identity';end if;
 end if;
 path:=current_setting('barford.prep.admin')||'/transactional-cover.jpg';
 insert into storage.objects(bucket_id,name,owner_id) values('baseline-event-covers',path,current_setting('barford.prep.admin'));
 rejected:=false;begin insert into storage.objects(bucket_id,name,owner_id) values('baseline-event-covers',current_setting('barford.prep.member')||'/wrong-folder.jpg',current_setting('barford.prep.admin'));exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'Admin cover upload allowed into another folder';end if;
 rejected:=false;begin insert into storage.objects(bucket_id,name,owner_id) values('baseline-event-covers',current_setting('barford.prep.admin')||'/unsafe.svg',current_setting('barford.prep.admin'));exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'Unexpected cover extension accepted';end if;
 -- Storage deletion must go through the Storage API, never direct SQL.
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Active admins delete own event covers' and cmd='DELETE' and qual like '%baseline-event-covers%' and qual like '%active_member%' and qual like '%is_admin%' and qual like '%foldername%' and qual like '%owner_id%') then raise exception 'Own-cover deletion policy is missing required checks';end if;
 rejected:=false;begin perform baseline_private.course_layout_core('get',jsonb_build_object('id',item->>'id'));exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'Old metadata bypass still callable';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('barford.prep.member'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare response jsonb;rejected boolean;begin
 response:=public.baseline_course_layout('event',jsonb_build_object('event_id',current_setting('barford.prep.event')::bigint));
 if response#>>'{layout,source,provider}'<>'openstreetmap' or response#>>'{layout,source,attribution}' is null then raise exception 'Member course map is missing source attribution';end if;
 rejected:=false;begin perform public.baseline_course_layout('match','{"place_id":"transactional-google-place"}');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Member can search admin course layouts';end if;
 rejected:=false;begin insert into storage.objects(bucket_id,name,owner_id) values('baseline-event-covers',current_setting('barford.prep.member')||'/member-cover.jpg',current_setting('barford.prep.member'));exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'Member cover upload permitted';end if;
end $$;
reset role;
do $$begin
 if not exists(select 1 from storage.buckets where id='baseline-event-covers' and public and file_size_limit=2097152 and allowed_mime_types=array['image/jpeg','image/png','image/webp']) then raise exception 'Cover bucket restrictions differ';end if;
end $$;
rollback;
select 'Course metadata, exact and legacy matching, reviewed preservation, member attribution, cover policies and rollback passed' verification;
