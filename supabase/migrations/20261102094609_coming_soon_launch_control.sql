-- Shared launch state. The existing password hash is preserved; no password is committed.
create table if not exists baseline_private.site_release (
  id integer primary key check (id = 1),
  is_live boolean not null default false,
  published_at timestamptz
);
alter table baseline_private.site_release enable row level security;
revoke all on baseline_private.site_release from public, anon, authenticated;
insert into baseline_private.site_release(id,is_live) values (1,false) on conflict (id) do nothing;

create table if not exists baseline_private.launch_attempts (
  actor_hash text primary key,
  started_at timestamptz not null,
  attempts integer not null
);
alter table baseline_private.launch_attempts enable row level security;
revoke all on baseline_private.launch_attempts from public, anon, authenticated;

create or replace function baseline_private.preview_token_valid(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_token is null or p_token !~ '^[a-f0-9]{64}$' then false
    else exists(select 1 from baseline_private.preview_sessions
      where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now()) end;
$$;
revoke all on function baseline_private.preview_token_valid(text) from public, anon, authenticated;

-- This intentionally supports anonymous preview holders. A valid password is the
-- preview credential; publishing additionally requires a current preview session.
create or replace function baseline_private.launch_gate(p_action text, p_password text, p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_live boolean; v_preview boolean; v_hash text; v_token text; v_actor text; v_count integer;
  v_headers jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  v_reply jsonb;
begin
  select is_live into v_live from baseline_private.site_release where id=1;
  v_live := coalesce(v_live,false);
  v_preview := baseline_private.preview_token_valid(p_token);
  v_reply := jsonb_build_object('live',v_live,'preview',v_preview);
  if p_action='status' then return v_reply; end if;
  if p_action not in ('unlock','publish') or p_action is null then
    return v_reply || jsonb_build_object('error','Unknown launch action.');
  end if;
  if coalesce(nullif(current_setting('request.method',true),''),'POST') <> 'POST' then
    return v_reply || jsonb_build_object('error','Use the password form to continue.');
  end if;

  v_actor := encode(extensions.digest('launch:' || coalesce(nullif(split_part(v_headers->>'x-forwarded-for',',',1),''),'unknown'),'sha256'),'hex');
  insert into baseline_private.launch_attempts(actor_hash,started_at,attempts) values(v_actor,now(),1)
  on conflict(actor_hash) do update set
    attempts=case when launch_attempts.started_at<now()-interval '15 minutes' then 1 else launch_attempts.attempts+1 end,
    started_at=case when launch_attempts.started_at<now()-interval '15 minutes' then now() else launch_attempts.started_at end
  returning attempts into v_count;
  delete from baseline_private.launch_attempts where started_at<now()-interval '2 days';
  if v_count>15 then return v_reply || jsonb_build_object('error','Too many attempts. Please try again in 15 minutes.'); end if;

  if p_password is null or length(p_password)<1 or length(p_password)>128 then
    return v_reply || jsonb_build_object('error','Incorrect password. Please try again.');
  end if;
  select password_hash into v_hash from baseline_private.preview_access where id=1;
  if v_hash is null or v_hash is distinct from extensions.crypt(p_password,v_hash) then
    return v_reply || jsonb_build_object('error','Incorrect password. Please try again.');
  end if;
  if p_action='unlock' then
    v_token:=encode(extensions.gen_random_bytes(32),'hex');
    delete from baseline_private.preview_sessions where expires_at<=now();
    insert into baseline_private.preview_sessions(token_hash,expires_at)
      values(encode(extensions.digest(v_token,'sha256'),'hex'),now()+interval '12 hours');
    return jsonb_build_object('live',v_live,'preview',true,'token',v_token);
  end if;
  if not v_preview then
    return v_reply || jsonb_build_object('error','Your preview has expired. Enter the admin preview password again.');
  end if;
  update baseline_private.site_release set is_live=true,published_at=coalesce(published_at,now()) where id=1;
  return jsonb_build_object('live',true,'preview',true);
end;
$$;
revoke all on function baseline_private.launch_gate(text,text,text) from public;
grant usage on schema baseline_private to service_role;
grant execute on function baseline_private.launch_gate(text,text,text) to anon, authenticated, service_role;

create or replace function public.baseline_site_gate(p_action text default 'status', p_password text default null, p_token text default null)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select baseline_private.launch_gate(p_action,p_password,p_token);
$$;
revoke all on function public.baseline_site_gate(text,text,text) from public;
grant execute on function public.baseline_site_gate(text,text,text) to anon, authenticated, service_role;

-- Keep old preview pages usable without retaining an unthrottled password endpoint.
create or replace function public.baseline_preview_unlock(p_password text)
returns text language sql volatile security invoker set search_path = '' as $$
  select baseline_private.launch_gate('unlock',p_password,null)->>'token';
$$;
create or replace function public.baseline_preview_valid(p_token text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select baseline_private.preview_token_valid(p_token);
$$;
revoke all on function public.baseline_preview_unlock(text), public.baseline_preview_valid(text) from public;
grant execute on function public.baseline_preview_unlock(text), public.baseline_preview_valid(text) to anon, authenticated, service_role;
grant execute on function baseline_private.preview_token_valid(text) to anon, authenticated, service_role;

-- Enforce the gate on all Data API routes, including SECURITY DEFINER RPCs.
-- Member/admin RLS and authorization still run after this additional gate.
create or replace function baseline_private.check_launch_request()
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_path text := ltrim(coalesce(current_setting('request.path',true),''),'/');
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  v_headers jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
begin
  if v_path='' or v_claims->>'role'='service_role' then return; end if;
  if v_path in ('rpc/baseline_site_gate','rpc/baseline_preview_unlock','rpc/baseline_preview_valid') then return; end if;
  if exists(select 1 from baseline_private.site_release where id=1 and is_live) then return; end if;
  if baseline_private.preview_token_valid(v_headers->>'x-barford-preview') then return; end if;
  raise sqlstate 'PT403' using message='The website is coming soon. Admin preview access is required.';
end;
$$;
revoke all on function baseline_private.check_launch_request() from public;
grant execute on function baseline_private.check_launch_request() to anon, authenticated, service_role;
alter role authenticator set pgrst.db_pre_request = 'baseline_private.check_launch_request';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
