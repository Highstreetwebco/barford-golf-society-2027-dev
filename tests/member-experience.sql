begin;
create temp table qa(u1 uuid,u2 uuid,u3 uuid,organiser uuid,ev bigint);
insert into qa values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),(select id from public.profiles where is_admin limit 1),null);
grant select on qa to authenticated,anon;
insert into public.baseline_members(id,name) select u1,'QA Pair One' from qa union all select u2,'QA Pair Two' from qa union all select u3,'QA Outsider' from qa;
insert into auth.users(id,email,raw_user_meta_data,aud,role,created_at,updated_at)
select x.id,'qa-'||x.id||'@example.invalid',jsonb_build_object('roster_id',x.id,'full_name','Forged Name','phone','07000000001','name_confirmation',true),'authenticated','authenticated',now(),now() from qa cross join lateral (values(u1),(u2),(u3)) x(id);
do $$begin
 if exists(select 1 from public.profiles where id in(select u1 from qa union all select u2 from qa) and full_name='Forged Name') then raise exception 'Signup name forgery allowed';end if;
 begin
 insert into auth.users(id,email,raw_user_meta_data,aud,role) values(gen_random_uuid(),'duplicate-qa@example.invalid',jsonb_build_object('roster_id',(select u1 from qa),'phone','07000000001','name_confirmation',true),'authenticated','authenticated');
 raise exception 'Duplicate roster claim allowed';
 exception when raise_exception then if sqlerrm<>'This name already has an account' then raise;end if;end;
 begin
 insert into auth.users(id,email,raw_user_meta_data,aud,role) values(gen_random_uuid(),'unconfirmed-qa@example.invalid',jsonb_build_object('roster_id',(select u1 from qa),'phone','07000000001'),'authenticated','authenticated');
 raise exception 'Missing confirmation accepted';
 exception when raise_exception then if sqlerrm<>'Choose your own scoreboard name and confirm it' then raise;end if;end;
end $$;
with inserted as (insert into public.baseline_events(name,date,max_players) values('QA temporary pair',current_date+7,4) returning id) update qa set ev=(select id from inserted);
select set_config('request.jwt.claim.sub',(select u1::text from qa),true);
set local role authenticated;
select public.baseline_submit_rsvp(jsonb_build_object('event_id',(select ev from qa),'attending',true,'buggy',true));
update public.profiles set full_name='Other Person' where id=(select u1 from qa);
do $$begin if (select full_name from public.profiles where id=auth.uid())<>'QA Pair One' then raise exception 'Username editing allowed';end if;end $$;
reset role;
select set_config('request.jwt.claim.sub',(select u2::text from qa),true);
set local role authenticated;
select public.baseline_submit_rsvp(jsonb_build_object('event_id',(select ev from qa),'attending',true,'buggy',true));
reset role;
select set_config('request.jwt.claim.sub',(select organiser::text from qa),true);
set local role authenticated;
select public.baseline_save_tee_times((select ev from qa),jsonb_build_array(jsonb_build_object('time','10:00','players',jsonb_build_array((select u1 from qa),(select u2 from qa)))));
reset role;
select set_config('request.jwt.claim.sub',(select u1::text from qa),true);
set local role authenticated;
do $$declare result jsonb;begin
 result:=public.baseline_buggy_details((select ev from qa),true,false);
 if result->>'partner_name'<>'QA Pair Two' or result->>'partner_phone'<>'07000000001' or result->>'booking_me'<>'true' then raise exception 'Pair/claim not returned';end if;
 begin perform * from public.baseline_buggy_pairs;raise exception 'Direct pair access allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select u2::text from qa),true);
set local role authenticated;
do $$declare result jsonb;begin
 result:=public.baseline_buggy_details((select ev from qa));
 if result->>'booking_name'<>'QA Pair One' then raise exception 'Partner cannot see booking owner';end if;
 begin perform public.baseline_buggy_details((select ev from qa),true,false);raise exception 'Double booking responsibility allowed';exception when raise_exception then if sqlerrm<>'Your partner is already booking the buggy. Contact them before changing this' then raise;end if;end;
 begin perform public.baseline_buggy_details((select ev from qa),false,true);raise exception 'Partner released another owner';exception when raise_exception then if sqlerrm<>'Only the person booking can release this' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select u3::text from qa),true);
set local role authenticated;
do $$declare result jsonb;begin result:=public.baseline_buggy_details((select ev from qa));if result ? 'partner_phone' then raise exception 'Outsider can read phone';end if;end $$;
reset role;
select set_config('request.jwt.claim.sub',(select organiser::text from qa),true);
set local role authenticated;
-- Same pair retains its booking owner when republished.
select public.baseline_save_tee_times((select ev from qa),jsonb_build_array(jsonb_build_object('time','10:08','players',jsonb_build_array((select u2 from qa),(select u1 from qa)))));
reset role;
do $$begin if (select booking_user from public.baseline_buggy_pairs where event_id=(select ev from qa))<>(select u1 from qa) then raise exception 'Unchanged pair lost booking owner';end if;end $$;
select set_config('request.jwt.claim.sub',(select organiser::text from qa),true);
set local role authenticated;
select public.baseline_release_member((select u1 from qa));
reset role;
select set_config('request.jwt.claim.sub',(select u1::text from qa),true);
set local role authenticated;
do $$begin
 begin perform public.baseline_submit_rsvp(jsonb_build_object('event_id',(select ev from qa),'attending',true));raise exception 'Released account can RSVP';exception when raise_exception then if sqlerrm<>'Contact an organiser about your account' then raise;end if;end;
 if not exists(select 1 from public.baseline_member_roster() where id=(select u1 from qa) and not claimed) then raise exception 'Released name unavailable';end if;
end $$;
reset role;
rollback;
select 'PASS: signup confirmation, unique roster claim, derived immutable username, optional tee preference, partner contact privacy, booking owner conflict, republishing, organiser release and blocked RSVP; all fixtures rolled back.' verification;
