-- Run in a transaction and roll back. Creates no durable members or payments.
select set_config('test.handicap_member',gen_random_uuid()::text,true);
select set_config('test.handicap_admin',gen_random_uuid()::text,true);
insert into auth.users(id,email,raw_user_meta_data)
values (current_setting('test.handicap_member')::uuid,'handicap-test-'||current_setting('test.handicap_member')||'@example.invalid','{"full_name":"Handicap test member","playing_category":"men","handicap":"malicious-invalid-number"}'::jsonb),
       (current_setting('test.handicap_admin')::uuid,'handicap-test-'||current_setting('test.handicap_admin')||'@example.invalid','{"full_name":"Handicap test admin","playing_category":"men"}'::jsonb);
update public.profiles set is_admin=true where id=current_setting('test.handicap_admin')::uuid;
do $$ begin
 if exists(select 1 from public.profiles where id in(current_setting('test.handicap_member')::uuid,current_setting('test.handicap_admin')::uuid) and handicap is not null) then raise exception 'Signup trusted member handicap metadata'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.handicap_member'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.handicap_member'),'role','authenticated')::text,true);
do $$ begin
 begin
   update public.profiles set handicap=12 where id=auth.uid();
   raise exception 'Member direct update unexpectedly allowed';
 exception when insufficient_privilege then null; end;
 begin
   perform public.set_initial_handicap(12);
   raise exception 'Legacy self-service unexpectedly allowed';
 exception when insufficient_privilege then null; end;
 begin
   perform public.admin_set_member_handicap(auth.uid(),12,null);
   raise exception 'Member admin-RPC unexpectedly allowed';
 exception when insufficient_privilege then null; end;
 update public.profiles set home_club='Profile edit still works' where id=auth.uid();
 if not found then raise exception 'Normal profile update failed'; end if;
 if public.get_member_notices()::text not like '%Handicap awaiting admin%' then raise exception 'Pending notice missing'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.handicap_admin'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.handicap_admin'),'role','authenticated')::text,true);
do $$ declare saved jsonb; begin
 saved:=public.admin_set_member_handicap(current_setting('test.handicap_member')::uuid,0,null);
 if (saved->>'handicap')::numeric <> 0 then raise exception 'Zero handicap not saved'; end if;
 saved:=public.admin_set_member_handicap(current_setting('test.handicap_member')::uuid,18.5,0);
 if (saved->>'handicap')::numeric <> 18.5 then raise exception 'Decimal handicap not saved'; end if;
 begin
   perform public.admin_set_member_handicap(current_setting('test.handicap_member')::uuid,20,0);
   raise exception 'Stale save unexpectedly allowed';
 exception when serialization_failure then null; end;
 begin
   perform public.admin_set_member_handicap(current_setting('test.handicap_member')::uuid,null,18.5);
   raise exception 'Missing value unexpectedly saved';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.admin_set_member_handicap(current_setting('test.handicap_member')::uuid,55,18.5);
   raise exception 'Out-of-range value unexpectedly saved';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.admin_set_member_handicap(current_setting('test.handicap_member')::uuid,'NaN'::numeric,18.5);
   raise exception 'NaN unexpectedly saved';
 exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.handicap_member'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.handicap_member'),'role','authenticated')::text,true);
do $$ begin
 if (select handicap from public.profiles where id=auth.uid()) <> 18.5 then raise exception 'Member cannot read assigned handicap'; end if;
 begin
   update public.profiles set handicap=null where id=auth.uid();
   raise exception 'Member cleared an assigned handicap';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
