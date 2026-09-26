create or replace function baseline_private.league_save_handicaps(entries jsonb,expected_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare entry jsonb; h numeric; uid uuid;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 perform pg_advisory_xact_lock(2027,501);
 if expected_revision is distinct from (select revision from baseline_private.league_state) then raise exception 'Scores or handicaps changed. Reload before saving'; end if;
 if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>200 then raise exception 'Invalid handicap list'; end if;
 if (select count(*)<>count(distinct x->>'user_id') from jsonb_array_elements(entries) x) then raise exception 'Duplicate player'; end if;
 for entry in select * from jsonb_array_elements(entries) loop
  uid:=(entry->>'user_id')::uuid; h:=(entry->>'handicap')::numeric;
  if not exists(select 1 from public.baseline_member_accounts where user_id=uid and not disabled) then raise exception 'Choose a registered member'; end if;
  if h is not null and (h::text in ('NaN','Infinity','-Infinity') or h<0 or h>54 or round(h,1)<>h) then raise exception 'Starting handicap must be 0 to 54, with at most one decimal place'; end if;
  update public.profiles set handicap=h where id=uid and handicap is distinct from h;
 end loop;
 insert into baseline_private.league_audit(actor,action,details) values(auth.uid(),'starting_handicaps',entries);
 return baseline_private.league_admin();
end $$;

create or replace function baseline_private.league_save_round(event bigint,entries jsonb,chosen_winner uuid,publish boolean,expected_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare ev public.baseline_events; entry jsonb; pts integer; uid uuid; cleaned jsonb:='[]'; high integer; winner_id uuid; leaders integer; cnt integer;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 perform pg_advisory_xact_lock(2027,501);
 if expected_revision is distinct from (select revision from baseline_private.league_state) then raise exception 'Scores or handicaps changed. Reload before saving'; end if;
 select * into ev from public.baseline_events where id=event for update;
 if ev.id is null or ev.round_number is null then raise exception 'Assign a league round to this event first'; end if;
 if ev.cancelled then raise exception 'Reopen this event before entering scores'; end if;
 if entries is null or jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>200 then raise exception 'Invalid score list'; end if;
 if (select count(*)<>count(distinct x->>'user_id') from jsonb_array_elements(entries) x) then raise exception 'Duplicate player'; end if;
 for entry in select * from jsonb_array_elements(entries) loop
  uid:=(entry->>'user_id')::uuid;
  if not exists(select 1 from public.baseline_member_accounts where user_id=uid and not disabled) then raise exception 'Choose a registered member'; end if;
  if coalesce(entry->>'status','') not in ('played','dnp','pending') then raise exception 'Choose score or DNP for each player'; end if;
  pts:=case when entry->>'status'='played' then (entry->>'points')::integer else null end;
  if entry->>'status'='played' and (pts is null or pts not between 1 and 108) then raise exception 'Enter 1 to 108 points, or choose DNP for zero'; end if;
  if publish and entry->>'status'='pending' then raise exception 'Complete every score or mark DNP before publishing'; end if;
  cleaned:=cleaned||jsonb_build_array(jsonb_build_object('user_id',uid,'points',pts,'status',entry->>'status'));
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
