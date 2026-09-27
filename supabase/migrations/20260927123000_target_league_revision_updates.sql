-- Target the singleton revision row explicitly for protected UPDATE enforcement.

create or replace function baseline_private.league_handicap_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.handicap is distinct from new.handicap then
  perform baseline_private.league_rebuild();
  update baseline_private.league_state set revision=revision+1 where id=true;
  insert into baseline_private.league_audit(actor,action,details) values(auth.uid(),'handicap_correction',jsonb_build_object('user_id',new.id,'before',old.handicap,'after',new.handicap));
 end if;
 return new;
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
 update baseline_private.league_state set revision=revision+1 where id=true;
 insert into baseline_private.league_audit(actor,action,details) values(auth.uid(),case when publish then 'publish_round' else 'save_draft' end,jsonb_build_object('event',event,'round',ev.round_number,'entries',cleaned,'winner',winner_id));
 return baseline_private.league_admin();
end $$;

create or replace function baseline_private.manual_handicap(who uuid,from_round integer,new_handicap numeric,reason text,expected_revision integer,remove boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare old_h numeric; prior jsonb;
begin
 if not baseline_private.active_member() or not public.is_admin() then raise exception 'Organiser access required'; end if;
 perform pg_advisory_xact_lock(2027,501);
 if expected_revision is distinct from (select revision from baseline_private.league_state) then raise exception 'Scores or handicaps changed. Reload before saving'; end if;
 if from_round is null or from_round not between 2 and 7 then raise exception 'Choose round 2 to 7'; end if;
 if exists(select 1 from baseline_private.league_rounds where published_entries is not null and round_number>=from_round) then raise exception 'Choose an unpublished future round. Earlier results cannot be changed here'; end if;
 if not exists(select 1 from public.baseline_member_accounts where user_id=who and not disabled) then raise exception 'Choose a registered member'; end if;
 if reason is null or length(trim(reason)) not between 5 and 1000 then raise exception 'Record the committee decision (5 to 1000 characters)'; end if;
 if not remove and (new_handicap is null or new_handicap::text in ('NaN','Infinity','-Infinity') or new_handicap<0 or new_handicap>100 or round(new_handicap,1)<>new_handicap) then raise exception 'Enter a handicap from 0 to 100, with at most one decimal place'; end if;
 old_h:=baseline_private.handicap_at(who,from_round);
 if old_h is null then raise exception 'Set this player’s starting handicap first'; end if;
 select to_jsonb(o) into prior from baseline_private.handicap_overrides o where user_id=who and round_number=from_round;
 if remove then delete from baseline_private.handicap_overrides where user_id=who and round_number=from_round;
 else insert into baseline_private.handicap_overrides values(who,from_round,new_handicap,trim(reason),auth.uid(),now()) on conflict(user_id,round_number) do update set handicap=excluded.handicap,reason=excluded.reason,actor=excluded.actor,created_at=now(); end if;
 update baseline_private.league_state set revision=revision+1 where id=true;
 insert into baseline_private.league_audit(actor,action,details) values(auth.uid(),'manual_handicap',jsonb_build_object('user_id',who,'from_round',from_round,'before',old_h,'after',case when remove then baseline_private.handicap_at(who,from_round) else new_handicap end,'reason',reason,'removed',remove,'previous_override',prior));
 return baseline_private.league_admin();
end $$;
