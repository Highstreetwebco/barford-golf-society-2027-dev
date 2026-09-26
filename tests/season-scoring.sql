begin;
create temp table qa_league(n integer,id uuid);
insert into qa_league select n,gen_random_uuid() from generate_series(1,6) n;
grant select on qa_league to authenticated,anon;
insert into public.baseline_members(id,name) select id,'QA Scoring '||n from qa_league;
insert into auth.users(id,email,raw_user_meta_data,aud,role,created_at,updated_at) select id,'qa-'||id||'@example.invalid',jsonb_build_object('roster_id',id,'phone','07000000001','name_confirmation',true),'authenticated','authenticated',now(),now() from qa_league;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where is_admin limit 1),true);
update public.profiles set handicap=20 where id in(select id from qa_league);
insert into public.baseline_events(name,date,round_number) select 'QA Scoring R'||n,('2027-01-01'::date + n*30),n from generate_series(1,7) n;
set local role authenticated;
do $$declare payload jsonb; result jsonb; rev integer; eid bigint; published jsonb; uid uuid; snapshot jsonb;begin
 select id into uid from qa_league where n=1;
 select jsonb_agg(jsonb_build_object('user_id',id,'status',case when n=6 then 'dnp' else 'played' end,'points',case n when 1 then 45 when 2 then 35 when 3 then 30 when 4 then 25 when 5 then 15 end) order by n) into payload from qa_league;
 select (public.baseline_league_admin()->>'revision')::integer into rev;
 select id into eid from public.baseline_events where round_number=1;
 result:=public.baseline_league_save_round(eid,payload,null,false,rev);
 if jsonb_array_length(public.baseline_league_board()->'rounds')<>0 then raise exception 'Draft leaked';end if;
 begin perform public.baseline_league_save_round(eid,payload,null,true,rev);raise exception 'Stale overwrite allowed';exception when raise_exception then if sqlerrm<>'Scores or handicaps changed. Reload before saving' then raise;end if;end;
 rev:=(result->>'revision')::integer;
 result:=public.baseline_league_save_round(eid,payload,null,true,rev);
 select r into published from jsonb_array_elements(result->'rounds') r where (r->>'round_number')::int=1;
 if (published->>'average')::int<>30 then raise exception 'Trimmed mean wrong';end if;
 if not exists(select 1 from jsonb_array_elements(published->'results') x where x->>'user_id'=uid::text and (x->>'adjustment')::int=-3 and (x->>'next_handicap')::numeric=17 and (x->>'winner')::boolean) then raise exception 'Winner adjustment wrong';end if;
 if not exists(select 1 from jsonb_array_elements(published->'results') x where x->>'user_id'=(select id::text from qa_league where n=6) and x->>'points' is null and (x->>'next_handicap')::numeric=20) then raise exception 'DNP did not preserve handicap';end if;
 -- Sequential publication, automatic carry and hidden-round boundary.
 for i in 2..7 loop
  select id into eid from public.baseline_events where round_number=i;
  result:=public.baseline_league_save_round(eid,payload,null,true,(result->>'revision')::int);
 end loop;
 if jsonb_array_length(public.baseline_league_board()->'rounds')<>7 then raise exception 'Admin cannot see secret rounds';end if;
 select r into published from jsonb_array_elements(result->'rounds') r where (r->>'round_number')::int=2;
 if not exists(select 1 from jsonb_array_elements(published->'results') x where x->>'user_id'=uid::text and (x->>'handicap')::numeric=17) then raise exception 'Next round did not carry handicap';end if;
 -- Republish is idempotent; wins are per round, never an incrementing counter.
 select id into eid from public.baseline_events where round_number=7;
 snapshot:=public.baseline_league_board();
 result:=public.baseline_league_save_round(eid,payload,null,true,(result->>'revision')::int);
 if public.baseline_league_board()<>snapshot then raise exception 'Republish changed totals or trophies';end if;
 -- Correct starting handicap and prove downstream recalc.
 result:=public.baseline_league_save_handicaps(jsonb_build_array(jsonb_build_object('user_id',uid,'handicap',9)),(result->>'revision')::int);
 select r into published from jsonb_array_elements(result->'rounds') r where (r->>'round_number')::int=2;
 if not exists(select 1 from jsonb_array_elements(published->'results') x where x->>'user_id'=uid::text and (x->>'handicap')::numeric=7) then raise exception 'Starting handicap correction did not reflow';end if;
 -- Score correction, tie requires explicit choice, half rounding and trimming four.
 select jsonb_agg(jsonb_build_object('user_id',id,'status',case when n>4 then 'dnp' else 'played' end,'points',case when n<=4 then 30 end)) into payload from qa_league;
 select id into eid from public.baseline_events where round_number=1;
 begin perform public.baseline_league_save_round(eid,payload,null,true,(result->>'revision')::int);raise exception 'Unresolved tie published';exception when raise_exception then if sqlerrm<>'Select the winner from the tied top scorers after countback' then raise;end if;end;
 result:=public.baseline_league_save_round(eid,payload,uid,true,(result->>'revision')::int);
 select r into published from jsonb_array_elements(result->'rounds') r where (r->>'round_number')::int=2;
 if not exists(select 1 from jsonb_array_elements(published->'results') x where x->>'user_id'=uid::text and (x->>'handicap')::numeric=9) then raise exception 'Score correction did not reflow';end if;
end $$;
reset role;
-- Exact active 2026 band logic, especially negative half values.
do $$begin
 if baseline_private.league_adjustment(34,30,20)<>-1 or baseline_private.league_adjustment(32,30,20)<>0 or baseline_private.league_adjustment(27,30,20)<>1 or baseline_private.league_adjustment(40,30,9)<>-2 or baseline_private.league_adjustment(45,30,30)<>-3 or baseline_private.league_adjustment(1,30,30)<>2 then raise exception 'Band boundaries/rounding failed';end if;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from qa_league where n=1),true);
set local role authenticated;
do $$declare board jsonb;begin
 board:=public.baseline_league_board();
 if (board->>'visible_rounds')::int<>5 or jsonb_array_length(board->'rounds')<>5 or exists(select 1 from jsonb_array_elements(board->'rounds') r where (r->>'round')::int>5) then raise exception 'Member secret-round leak';end if;
 begin perform public.baseline_league_admin();raise exception 'Member read drafts';exception when raise_exception then if sqlerrm<>'Organiser access required' then raise;end if;end;
 begin perform public.baseline_league_save_handicaps('[]',0);raise exception 'Member changed handicap';exception when raise_exception then if sqlerrm<>'Organiser access required' then raise;end if;end;
 begin perform public.baseline_league_save_round(1,'[]',null,true,0);raise exception 'Member published scores';exception when raise_exception then if sqlerrm<>'Organiser access required' then raise;end if;end;
 begin perform * from baseline_private.league_rounds;raise exception 'Raw private scores accessible';exception when insufficient_privilege then null;end;
 begin perform * from public.baseline_scores;raise exception 'Legacy score route accessible';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role anon;
do $$begin
 if (public.baseline_league_board()->>'visible_rounds')::int<>5 then raise exception 'Anonymous secret round leak';end if;
 begin perform baseline_private.league_rebuild();raise exception 'Anonymous rebuild allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: drafts, optimistic locking, trimmed average, DNP, handicap bands and rounding, next-round carry, seven rounds, correction reflow, winner tie selection, idempotence, member and anonymous secrecy, direct access and write denials. Fixtures rolled back.' verification;
