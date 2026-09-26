-- Isolated 2027 scoring. Raw entries, drafts, hidden rounds and audit stay private.
alter table public.baseline_events add column round_number integer check(round_number between 1 and 7);
create unique index baseline_event_round on public.baseline_events(round_number) where round_number is not null;
create table baseline_private.league_state(id boolean primary key default true check(id),revision integer not null default 0);
insert into baseline_private.league_state default values;
create table baseline_private.league_rounds(
 event_id bigint primary key references public.baseline_events(id) on delete restrict,
 round_number integer unique not null check(round_number between 1 and 7),
 draft jsonb not null default '[]', draft_winner uuid,
 published_entries jsonb, winner uuid, average integer, results jsonb,
 updated_at timestamptz not null default now(), published_at timestamptz
);
create table baseline_private.league_audit(id bigint generated always as identity primary key,actor uuid,action text not null,details jsonb not null,created_at timestamptz not null default now());
alter table baseline_private.league_state enable row level security;
alter table baseline_private.league_rounds enable row level security;
alter table baseline_private.league_audit enable row level security;
revoke all on baseline_private.league_state,baseline_private.league_rounds,baseline_private.league_audit from public,anon,authenticated;
-- Retire the old publicly readable score tables (empty on this new season).
revoke all on public.baseline_scores,public.baseline_players from anon,authenticated;
revoke execute on function public.baseline_reset_scores() from anon,authenticated;

create function baseline_private.league_adjustment(points integer,average integer,handicap numeric)
returns integer language sql immutable security invoker set search_path='' as $$
 select greatest(-3,least(2,floor((case
 when points-average>=10 then -4 when points-average>=8 then -3 when points-average>=6 then -2
 when points-average>=4 then -1 when points-average>=2 then -0.5 when points-average>=-1 then 0
 when points-average>=-3 then 0.5 when points-average>=-5 then 1 when points-average>=-7 then 2
 when points-average>=-9 then 3 else 4 end)
 *(case when handicap<=9 then 0.5 when handicap<=18 then 0.75 when handicap<=28 then 1 else 1.25 end)+0.5)::integer));
$$;
-- floor(x + .5) deliberately matches JavaScript Math.round, including negative halves.
create function baseline_private.league_rebuild() returns void language plpgsql security definer set search_path='' as $$
declare rr record; pp record; running jsonb:='{}'; out_rows jsonb; h numeric; pts integer; adjustment integer; av integer; n integer;
begin
 for rr in select * from baseline_private.league_rounds where published_entries is not null order by round_number loop
  select count(*) into n from jsonb_array_elements(rr.published_entries) x where (x->>'points')::integer>0;
  select floor(avg(points)+0.5)::integer into av from (
   select (x->>'points')::integer points,row_number() over(order by (x->>'points')::integer) pos
   from jsonb_array_elements(rr.published_entries) x where (x->>'points')::integer>0
  ) t where n<=4 or (pos>1 and pos<n);
  out_rows:='[]';
  for pp in select p.id,p.handicap from public.profiles p join public.baseline_member_accounts a on a.user_id=p.id where not a.disabled order by p.id loop
   h:=coalesce((running->>pp.id::text)::numeric,pp.handicap);
   select (x->>'points')::integer into pts from jsonb_array_elements(rr.published_entries) x where x->>'user_id'=pp.id::text;
   if pts is not null and h is null then raise exception 'Set the starting handicap for every player with a score'; end if;
   adjustment:=case when pts is null then 0 else baseline_private.league_adjustment(pts,av,h) end;
   out_rows:=out_rows||jsonb_build_array(jsonb_build_object('user_id',pp.id,'handicap',h,'points',pts,'adjustment',case when pts is null then null else adjustment end,'next_handicap',case when h is null then null else greatest(0,h+adjustment) end,'winner',coalesce(pp.id=rr.winner,false)));
   if h is not null then running:=jsonb_set(running,array[pp.id::text],to_jsonb(greatest(0,h+adjustment))); end if;
  end loop;
  update baseline_private.league_rounds set average=av,results=out_rows where event_id=rr.event_id;
 end loop;
end $$;

create function baseline_private.league_admin() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 return jsonb_build_object('revision',(select revision from baseline_private.league_state),'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'starting_handicap',p.handicap) order by lower(p.full_name)) from public.profiles p join public.baseline_member_accounts a on a.user_id=p.id where not a.disabled),'[]'::jsonb),'rounds',coalesce((select jsonb_agg(to_jsonb(r) order by round_number) from baseline_private.league_rounds r),'[]'::jsonb));
end $$;
create function baseline_private.league_save_handicaps(entries jsonb,expected_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare x jsonb; h numeric; uid uuid;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 perform pg_advisory_xact_lock(2027,501);
 if expected_revision is distinct from (select revision from baseline_private.league_state) then raise exception 'Scores or handicaps changed. Reload before saving'; end if;
 if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>200 then raise exception 'Invalid handicap list'; end if;
 if (select count(*)<>count(distinct x->>'user_id') from jsonb_array_elements(entries) x) then raise exception 'Duplicate player'; end if;
 for x in select * from jsonb_array_elements(entries) loop
  uid:=(x->>'user_id')::uuid; h:=(x->>'handicap')::numeric;
  if not exists(select 1 from public.baseline_member_accounts where user_id=uid and not disabled) then raise exception 'Choose a registered member'; end if;
  if h is not null and (h::text in ('NaN','Infinity','-Infinity') or h<0 or h>54 or round(h,1)<>h) then raise exception 'Starting handicap must be 0 to 54, with at most one decimal place'; end if;
  update public.profiles set handicap=h where id=uid and handicap is distinct from h;
 end loop;
 insert into baseline_private.league_audit(actor,action,details) values(auth.uid(),'starting_handicaps',entries);
 return baseline_private.league_admin();
end $$;
-- All existing account-edit routes share the same starting handicap and rebuild results.
create function baseline_private.league_handicap_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.handicap is distinct from new.handicap then
  perform pg_advisory_xact_lock(2027,501);
  if new.handicap is null and exists(select 1 from baseline_private.league_rounds r,jsonb_array_elements(r.published_entries) x where x->>'user_id'=new.id::text and x->>'points' is not null) then raise exception 'A player with published scores needs a starting handicap'; end if;
 end if;
 return new;
end $$;
create function baseline_private.league_handicap_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.handicap is distinct from new.handicap then
  perform baseline_private.league_rebuild();
  update baseline_private.league_state set revision=revision+1;
  insert into baseline_private.league_audit(actor,action,details) values(auth.uid(),'handicap_correction',jsonb_build_object('user_id',new.id,'before',old.handicap,'after',new.handicap));
 end if;
 return new;
end $$;
create trigger baseline_league_handicap_guard before update of handicap on public.profiles for each row execute function baseline_private.league_handicap_guard();
create trigger baseline_league_handicap_changed after update of handicap on public.profiles for each row execute function baseline_private.league_handicap_changed();
create function baseline_private.league_event_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.round_number is distinct from old.round_number and exists(select 1 from baseline_private.league_rounds where event_id=old.id) then raise exception 'This event already has scores or a saved draft; its round cannot change'; end if;
 return new;
end $$;
create trigger baseline_league_event_guard before update of round_number on public.baseline_events for each row execute function baseline_private.league_event_guard();

create function baseline_private.league_save_round(event bigint,entries jsonb,chosen_winner uuid,publish boolean,expected_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare ev public.baseline_events; x jsonb; pts integer; uid uuid; cleaned jsonb:='[]'; high integer; winner_id uuid; leaders integer; cnt integer;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 perform pg_advisory_xact_lock(2027,501);
 if expected_revision is distinct from (select revision from baseline_private.league_state) then raise exception 'Scores or handicaps changed. Reload before saving'; end if;
 select * into ev from public.baseline_events where id=event for update;
 if ev.id is null or ev.round_number is null then raise exception 'Assign a league round to this event first'; end if;
 if ev.cancelled then raise exception 'Reopen this event before entering scores'; end if;
 if entries is null or jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>200 then raise exception 'Invalid score list'; end if;
 if (select count(*)<>count(distinct x->>'user_id') from jsonb_array_elements(entries) x) then raise exception 'Duplicate player'; end if;
 for x in select * from jsonb_array_elements(entries) loop
  uid:=(x->>'user_id')::uuid;
  if not exists(select 1 from public.baseline_member_accounts where user_id=uid and not disabled) then raise exception 'Choose a registered member'; end if;
  if coalesce(x->>'status','') not in ('played','dnp','pending') then raise exception 'Choose score or DNP for each player'; end if;
  pts:=case when x->>'status'='played' then (x->>'points')::integer else null end;
  if x->>'status'='played' and (pts is null or pts not between 1 and 108) then raise exception 'Enter 1 to 108 points, or choose DNP for zero'; end if;
  if publish and x->>'status'='pending' then raise exception 'Complete every score or mark DNP before publishing'; end if;
  cleaned:=cleaned||jsonb_build_array(jsonb_build_object('user_id',uid,'points',pts,'status',x->>'status'));
 end loop;
 if publish then
  if exists(select 1 from generate_series(1,ev.round_number-1) n where not exists(select 1 from baseline_private.league_rounds r where r.round_number=n and published_entries is not null)) then raise exception 'Publish earlier rounds first so handicaps are correct'; end if;
  if exists(select 1 from public.baseline_rsvps r where r.event_id=event and r.attending and not r.reserve and not exists(select 1 from jsonb_array_elements(cleaned) x where x->>'user_id'=r.user_id::text)) then raise exception 'The RSVP list changed. Reload and complete every confirmed player'; end if;
  select count(*),max((x->>'points')::integer) into cnt,high from jsonb_array_elements(cleaned) x where x->>'points' is not null;
  if cnt<4 then raise exception 'At least four played scores are needed for handicap calculation'; end if;
  select count(*) into leaders from jsonb_array_elements(cleaned) x where (x->>'points')::integer=high;
  if leaders=1 then select (x->>'user_id')::uuid into winner_id from jsonb_array_elements(cleaned) x where (x->>'points')::integer=high;
  else
   if chosen_winner is null or not exists(select 1 from jsonb_array_elements(cleaned) x where (x->>'points')::integer=high and x->>'user_id'=chosen_winner::text) then raise exception 'Select the winner from the tied top scorers after countback'; end if;
   winner_id:=chosen_winner;
  end if;
 end if;
 insert into baseline_private.league_rounds(event_id,round_number,draft,draft_winner) values(event,ev.round_number,cleaned,chosen_winner)
 on conflict(event_id) do update set draft=excluded.draft,draft_winner=excluded.draft_winner,updated_at=now();
 if publish then
  update baseline_private.league_rounds set published_entries=cleaned,winner=winner_id,published_at=now() where event_id=event;
  perform baseline_private.league_rebuild();
 end if;
 update baseline_private.league_state set revision=revision+1;
 insert into baseline_private.league_audit(actor,action,details) values(auth.uid(),case when publish then 'publish_round' else 'save_draft' end,jsonb_build_object('event',event,'round',ev.round_number,'entries',cleaned,'winner',winner_id));
 return baseline_private.league_admin();
end $$;

-- Censor before aggregation: neither total, wins, rank nor handicap can reveal R6/R7.
create function baseline_private.league_board() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cutoff integer:=5; rounds_json jsonb; players_json jsonb;
begin
 if public.is_admin() then cutoff:=7; end if;
 select coalesce(jsonb_agg(jsonb_build_object('round',r.round_number,'event_id',r.event_id,'average',r.average,'results',r.results) order by r.round_number),'[]') into rounds_json from baseline_private.league_rounds r where r.round_number<=cutoff and r.published_entries is not null;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'starting_handicap',p.handicap) order by lower(p.full_name)),'[]') into players_json from public.profiles p join public.baseline_member_accounts a on a.user_id=p.id where not a.disabled;
 return jsonb_build_object('players',players_json,'rounds',rounds_json,'visible_rounds',cutoff);
end $$;

-- Only guarded entry points are callable. Internal helpers cannot be invoked by members.
revoke all on function baseline_private.league_adjustment(integer,integer,numeric),baseline_private.league_rebuild(),baseline_private.league_handicap_guard(),baseline_private.league_handicap_changed(),baseline_private.league_event_guard() from public,anon,authenticated;
revoke all on function baseline_private.league_admin(),baseline_private.league_save_handicaps(jsonb,integer),baseline_private.league_save_round(bigint,jsonb,uuid,boolean,integer),baseline_private.league_board() from public,anon,authenticated;
grant execute on function baseline_private.league_admin(),baseline_private.league_save_handicaps(jsonb,integer),baseline_private.league_save_round(bigint,jsonb,uuid,boolean,integer) to authenticated;
grant usage on schema baseline_private to anon;
grant execute on function baseline_private.league_board() to anon,authenticated;
create function public.baseline_league_admin() returns jsonb language sql stable security invoker set search_path='' as $$select baseline_private.league_admin();$$;
create function public.baseline_league_save_handicaps(entries jsonb,expected_revision integer) returns jsonb language sql security invoker set search_path='' as $$select baseline_private.league_save_handicaps(entries,expected_revision);$$;
create function public.baseline_league_save_round(event bigint,entries jsonb,chosen_winner uuid,publish boolean,expected_revision integer) returns jsonb language sql security invoker set search_path='' as $$select baseline_private.league_save_round(event,entries,chosen_winner,publish,expected_revision);$$;
create function public.baseline_league_board() returns jsonb language sql stable security invoker set search_path='' as $$select baseline_private.league_board();$$;
revoke all on function public.baseline_league_admin(),public.baseline_league_save_handicaps(jsonb,integer),public.baseline_league_save_round(bigint,jsonb,uuid,boolean,integer),public.baseline_league_board() from public,anon,authenticated;
grant execute on function public.baseline_league_admin(),public.baseline_league_save_handicaps(jsonb,integer),public.baseline_league_save_round(bigint,jsonb,uuid,boolean,integer) to authenticated;
grant execute on function public.baseline_league_board() to anon,authenticated;
