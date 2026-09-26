begin;
create temp table qa_accounts(member uuid,admin uuid);
insert into qa_accounts values(gen_random_uuid(),(select id from public.profiles where is_admin limit 1));
grant select on qa_accounts to authenticated,anon;
insert into public.baseline_members(id,name) select member,'QA Admin Test Member' from qa_accounts;
insert into auth.users(id,email,raw_user_meta_data,aud,role,created_at,updated_at) select member,'qa-'||member||'@example.invalid',jsonb_build_object('roster_id',member,'phone','07000000001','name_confirmation',true),'authenticated','authenticated',now(),now() from qa_accounts;
select set_config('request.jwt.claim.sub',(select member::text from qa_accounts),true);
set local role authenticated;
do $$begin
 begin perform * from public.baseline_admin_accounts();raise exception 'Member can list private accounts';exception when raise_exception then if sqlerrm<>'Organiser access required' then raise;end if;end;
 begin perform public.baseline_admin_save_account((select member from qa_accounts),'QA Admin Test Member','07000000001',12,true);raise exception 'Member can elevate role';exception when raise_exception then if sqlerrm<>'Organiser access required' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select admin::text from qa_accounts),true);
set local role authenticated;
do $$declare original_name text;phone text;begin
 if not exists(select 1 from public.baseline_admin_accounts() where id=(select member from qa_accounts)) then raise exception 'Admin cannot review accounts';end if;
 perform public.baseline_admin_save_account((select member from qa_accounts),'QA Renamed Member','07000000009',18.2,true);
 if not exists(select 1 from public.baseline_admin_accounts() where id=(select member from qa_accounts) and username='QA Renamed Member' and mobile='07000000009' and handicap=18.2 and is_admin) then raise exception 'Account editing failed';end if;
 perform public.baseline_admin_save_account((select member from qa_accounts),'QA Renamed Member','07000000009',18.2,false);
 select username,mobile into original_name,phone from public.baseline_admin_accounts() where id=auth.uid();
 begin perform public.baseline_admin_save_account(auth.uid(),original_name,phone,null,false);raise exception 'Self-demotion allowed';exception when raise_exception then if sqlerrm<>'You cannot remove your own admin access' then raise;end if;end;
 begin perform public.baseline_admin_save_account((select member from qa_accounts),original_name,'07000000001',12,false);raise exception 'Duplicate username allowed';exception when raise_exception then if sqlerrm<>'That username is already in use' then raise;end if;end;
 if (select count(*) from public.admin_role_audit where member_id=(select member from qa_accounts))<>2 then raise exception 'Role changes not audited';end if;
end $$;
reset role;
-- A deleted account's still-unexpired JWT must fail member reads.
select set_config('request.jwt.claim.sub','a3ecf46e-97c5-4b04-a66c-3d434be491be',true);
set local role authenticated;
do $$begin if baseline_private.active_member() then raise exception 'Deleted account still active';end if;end $$;
reset role;
rollback;
select 'PASS: admin-only account review, member role escalation denied, profile and username edits, grant/revoke admin, role audit, self-demotion and duplicate-name protection, removed-account access. All fixtures rolled back.' verification;
