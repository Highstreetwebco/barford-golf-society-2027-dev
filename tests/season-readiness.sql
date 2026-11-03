-- Rollback-only registration and public leaderboard checks. No real users change.
begin;
create temp table ready_qa(admin uuid, member_id uuid, user_id uuid, event_id bigint);
insert into ready_qa select (select id from public.profiles where is_admin limit 1),
  gen_random_uuid(), gen_random_uuid(), null;
grant select on ready_qa to authenticated, anon;
insert into public.baseline_members(id, name)
select member_id, 'QA Season Ready Member' from ready_qa;
with e as (
  insert into public.baseline_events(name,date,max_players,member_price)
  values ('QA readiness event',current_date+60,40,45) returning id
) update ready_qa set event_id=(select id from e);
select set_config('request.jwt.claim.sub',(select admin::text from ready_qa),true);
set local role authenticated;
do $$begin
  perform public.baseline_submit_rsvp(jsonb_build_object(
    'event_id',(select event_id from ready_qa),'member_id',(select member_id from ready_qa),'attending',true));
  if exists(select 1 from jsonb_array_elements(public.baseline_league_board()->'players') x
    where x->>'id'=(select member_id::text from ready_qa)) then
    raise exception 'Offline booking appeared on the public leaderboard';
  end if;
  if (public.baseline_league_board()->>'visible_rounds')::int<>7 then
    raise exception 'Admin lost secret round access';
  end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,email,raw_user_meta_data,aud,role,created_at,updated_at)
select user_id,'qa-season-'||user_id||'@example.invalid',
  jsonb_build_object('roster_id',member_id,'phone','07000000001','name_confirmation',true),
  'authenticated','authenticated',now(),now() from ready_qa;
select set_config('request.jwt.claim.sub',(select user_id::text from ready_qa),true);
set local role authenticated;
do $$begin
  if not exists(select 1 from jsonb_array_elements(public.baseline_league_board()->'players') x
    where x->>'id'=(select user_id::text from ready_qa)) then
    raise exception 'Account creation did not add the member to the leaderboard';
  end if;
  if (public.baseline_league_board()->>'visible_rounds')::int<>5 then
    raise exception 'Member received admin visibility';
  end if;
  if exists(select 1 from jsonb_array_elements(public.baseline_league_board()->'rounds') r
    where (r->>'round')::int>5) then raise exception 'Secret results leaked'; end if;
  begin
    perform * from baseline_private.season_reset_archives;
    raise exception 'Member can read reset archive';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.baseline_member_accounts set disabled=true where user_id=(select user_id from ready_qa);
do $$begin
  if exists(select 1 from jsonb_array_elements(public.baseline_league_board()->'players') x
    where x->>'id'=(select user_id::text from ready_qa)) then raise exception 'Disabled account appears'; end if;
end $$;
update public.baseline_member_accounts set disabled=false where user_id=(select user_id from ready_qa);
update public.baseline_members set invite_only=true where id=(select member_id from ready_qa);
do $$begin
  if exists(select 1 from jsonb_array_elements(public.baseline_league_board()->'players') x
    where x->>'id'=(select user_id::text from ready_qa)) then raise exception 'Guest appears as society member'; end if;
end $$;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$begin
  if (public.baseline_league_board()->>'visible_rounds')::int<>5 then raise exception 'Visitor received admin visibility'; end if;
  begin
    perform * from baseline_private.season_reset_archives;
    raise exception 'Visitor can read reset archive';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: account registration adds a member, offline bookings/disabled accounts/guests stay off the leaderboard, admin/member visibility preserved and reset archive is private; all fixtures rolled back.' as verification;
