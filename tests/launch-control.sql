-- Rollback-only tests: the production password and release state are never changed.
begin;
update baseline_private.site_release set is_live=false,published_at=null where id=1;
update baseline_private.preview_access set password_hash=extensions.crypt('fixture-launch-password',extensions.gen_salt('bf',4)) where id=1;
select set_config('request.headers','{"x-forwarded-for":"launch-test-fixture"}',true);
select set_config('request.method','POST',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
select set_config('request.path','/rpc/baseline_site_gate',true);
set local role anon;
do $$
declare r jsonb; t text; rejected boolean:=false;
begin
  r:=public.baseline_site_gate('status');
  assert r->>'live'='false' and r->>'preview'='false','Site must start closed';
  r:=public.baseline_site_gate('unlock','wrong-password');
  assert r ? 'error' and not (r ? 'token'),'Wrong password must not issue a preview token';
  r:=public.baseline_site_gate('publish','fixture-launch-password');
  assert r ? 'error' and r->>'live'='false','Publishing needs both the password and a preview session';
  r:=public.baseline_site_gate('unlock','fixture-launch-password');t:=r->>'token';
  assert length(t)=64 and r->>'preview'='true','Correct password must unlock preview';
  assert public.baseline_preview_valid(t),'Legacy token verification remains compatible';
  perform set_config('request.path','/baseline_events',true);
  begin perform baseline_private.check_launch_request(); exception when sqlstate 'PT403' then rejected:=true; end;
  assert rejected,'Anonymous direct data access must be blocked before launch';
  perform set_config('request.headers',jsonb_build_object('x-forwarded-for','launch-test-fixture','x-barford-preview',t)::text,true);
  perform baseline_private.check_launch_request();
  r:=public.baseline_site_gate('publish','wrong-password',t);
  assert r ? 'error' and r->>'live'='false','Preview token alone must not publish';
  r:=public.baseline_site_gate('publish','fixture-launch-password',t);
  assert r->>'live'='true','Password-confirmed launch must open the site';
  perform set_config('request.headers','{}',true);
  perform baseline_private.check_launch_request();
  r:=public.baseline_site_gate('status');assert r->>'live'='true','A fresh visitor must see the global live state';
  assert not has_table_privilege('anon','baseline_private.site_release','UPDATE'),'Anonymous users cannot directly change launch state';
  assert not has_table_privilege('authenticated','baseline_private.preview_access','SELECT'),'Password hashes stay private';
end $$;
reset role;
-- Expired sessions must be rejected; throttling must also cover the old unlock RPC.
update baseline_private.site_release set is_live=false,published_at=null where id=1;
insert into baseline_private.preview_sessions(token_hash,expires_at) values(encode(extensions.digest(repeat('f',64),'sha256'),'hex'),now()-interval '1 second') on conflict(token_hash) do update set expires_at=excluded.expires_at;
select set_config('request.headers','{"x-forwarded-for":"launch-test-throttle"}',true);
set local role anon;
do $$
declare r jsonb;
begin
 assert not public.baseline_preview_valid(repeat('f',64)),'Expired sessions must not validate';
 for n in 1..15 loop perform public.baseline_preview_unlock('wrong-password'); end loop;
 r:=public.baseline_site_gate('unlock','fixture-launch-password');
 assert r->>'error' like 'Too many attempts%','Attempts must be limited across both unlock routes';
end $$;
reset role;
rollback;
