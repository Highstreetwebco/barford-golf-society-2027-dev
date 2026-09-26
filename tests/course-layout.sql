-- Run only against the 2027 development project. Every test record rolls back.
begin;
do $$declare admin_id uuid; member_id uuid:=gen_random_uuid(); roster_id uuid;begin
 select p.id into admin_id from public.profiles p join public.baseline_member_accounts a on a.user_id=p.id where p.is_admin and not a.disabled limit 1;
 if admin_id is null then raise exception 'An existing active admin is needed for this test'; end if;
 select id into roster_id from public.baseline_members m where not invite_only and not exists(select 1 from public.baseline_member_accounts a where a.member_id=m.id) limit 1;
 if roster_id is null then raise exception 'An unclaimed roster entry is needed for the rolled-back member test'; end if;
 insert into auth.users(id,email,raw_user_meta_data) values(member_id,'transaction-hole-check@example.invalid',jsonb_build_object('full_name','Transaction hole check','playing_category','men','phone','07700900123','roster_id',roster_id,'name_confirmation',true));
 perform set_config('barford.test.member',member_id::text,true);
 perform set_config('barford.test.admin',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
end $$;
set local role authenticated;
do $$declare item jsonb; saved jsonb; response jsonb; bad jsonb; rejected boolean; eid bigint; legacy jsonb; imported jsonb;begin
 item:=public.baseline_course_layout('save','{"name":"Transactional GPS check","tee_name":"Yellow","holes":[{"number":1,"par":4,"yards":410,"stroke_index":1,"tee":{"lat":52,"lng":-1},"green":{"lat":52.001,"lng":-1.001},"front":{"lat":52.0009,"lng":-1.001},"back":{"lat":52.0011,"lng":-1.001},"reviewed":true},{"number":2,"par":3,"yards":140,"stroke_index":2,"tee":{"lat":52.002,"lng":-1.002},"green":{"lat":52.003,"lng":-1.002},"reviewed":false}]}');
 if jsonb_array_length(item->'holes')<>18 or item->>'ready_count'<>'1' or item#>>'{holes,17,number}'<>'18' then raise exception 'Missing holes not normalised to all 18 slots'; end if;
 perform set_config('barford.test.layout',item->>'id',true);
 for bad in select * from jsonb_array_elements('[
  [{"number":19}], [{"number":1.5}], [{"number":1},{"number":1}],
  [{"number":1,"tee":{"lat":91,"lng":0}}], [{"number":1,"green":{"lat":0,"lng":181}}],
  [{"number":1,"tee":{"lat":"52","lng":-1}}], [{"number":1,"par":7}], [{"number":1,"yards":0}],
  [{"number":1,"stroke_index":1},{"number":2,"stroke_index":1}], [{"number":1,"reviewed":true}],
  [{"number":1,"tee":{"lat":52,"lng":-1},"green":{"lat":52,"lng":-1},"reviewed":true}],
  [{"number":1,"reviewed":"true"}]
 ]'::jsonb) loop
  rejected:=false;begin perform public.baseline_course_layout('save',jsonb_build_object('name','Bad fixture','tee_name','Yellow','holes',bad)); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Invalid layout accepted: %',bad; end if;
 end loop;
 rejected:=false;begin perform public.baseline_course_layout('save',item||'{"revision":99}');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Stale layout save accepted';end if;
 saved:=public.baseline_course_layout('save',item||'{"name":"Updated transaction course"}');
 if saved->>'revision'<>'1' or saved->>'name'<>'Updated transaction course' then raise exception 'Valid optimistic save failed';end if;
 insert into public.baseline_events(name,date,event_type,course_layout_id) values('Transactional GPS check',current_date,'pairs',(item->>'id')::uuid) returning id into eid;
 perform set_config('barford.test.event',eid::text,true);
 response:=public.baseline_course_layout('event',jsonb_build_object('event_id',eid));
 if response#>'{layout,holes,1,tee}'='null'::jsonb then raise exception 'Admin cannot preview draft coordinates';end if;
 rejected:=false;begin insert into public.baseline_events(name,date,event_type,course_layout_id) values('Invalid social',current_date,'social',(item->>'id')::uuid);exception when check_violation then rejected:=true;end;
 if not rejected then raise exception 'Social course layout accepted';end if;
 rejected:=false;begin perform public.baseline_course_layout('attach',jsonb_build_object('event_id',eid,'layout_id',item->>'id','expected_layout_id',null));exception when others then rejected:=true;end;
 if not rejected then raise exception 'Stale event attachment accepted';end if;
 response:=public.baseline_course_layout('attach',jsonb_build_object('event_id',eid,'layout_id',item->>'id','expected_layout_id',item->>'id'));
 for legacy in select * from jsonb_array_elements(public.baseline_course_layout('list')->'legacy') loop
  imported:=public.baseline_course_layout('import',jsonb_build_object('legacy_id',legacy->>'id'));
  if imported->>'ready_count'<>'0' or jsonb_array_length(imported->'holes')<>18 then raise exception 'Imported layout was published without review';end if;
  if public.baseline_course_layout('import',jsonb_build_object('legacy_id',legacy->>'id'))->>'id'<>imported->>'id' then raise exception 'Import retry duplicated layout';end if;
 end loop;
 rejected:=false;begin perform 1 from baseline_private.course_layouts;exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'Private course table is directly exposed';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('barford.test.member'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare response jsonb; rejected boolean; act text;begin
 response:=public.baseline_course_layout('event',jsonb_build_object('event_id',current_setting('barford.test.event')::bigint));
 if response#>'{layout,holes,0,tee}'='null'::jsonb or response#>'{layout,holes,1,tee}'<>'null'::jsonb or response#>>'{layout,ready_count}'<>'1' then raise exception 'Member review boundary failed';end if;
 foreach act in array array['list','get','save','import','attach'] loop
  rejected:=false;begin perform public.baseline_course_layout(act,jsonb_build_object('id',current_setting('barford.test.layout'),'event_id',current_setting('barford.test.event')::bigint));exception when others then rejected:=true;end;
  if not rejected then raise exception 'Member admin action allowed: %',act;end if;
 end loop;
 rejected:=false;begin perform 1 from baseline_private.course_layouts;exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'Member can access private course table';end if;
end $$;
reset role;
update public.baseline_events set cancelled=true where id=current_setting('barford.test.event')::bigint;
set local role authenticated;
do $$declare rejected boolean:=false;begin
 begin perform public.baseline_course_layout('event',jsonb_build_object('event_id',current_setting('barford.test.event')::bigint));exception when others then rejected:=true;end;
 if not rejected then raise exception 'Cancelled course event readable';end if;
end $$;
reset role;
update public.baseline_events set cancelled=false where id=current_setting('barford.test.event')::bigint;
update public.baseline_member_accounts set disabled=true where user_id=current_setting('barford.test.member')::uuid;
set local role authenticated;
do $$declare rejected boolean:=false;begin
 begin perform public.baseline_course_layout('event',jsonb_build_object('event_id',current_setting('barford.test.event')::bigint));exception when others then rejected:=true;end;
 if not rejected then raise exception 'Disabled member course access allowed';end if;
end $$;
reset role;
set local role anon;
do $$declare rejected boolean:=false;begin
 begin perform public.baseline_course_layout('event',jsonb_build_object('event_id',current_setting('barford.test.event')::bigint));exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'Anonymous course access allowed';end if;
end $$;
reset role;
rollback;
select 'Course layout validation, revisions, active member/admin separation, draft privacy, all legacy tee imports, direct event attachment and rollback passed' verification;
