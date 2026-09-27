-- Expose publication time only for rounds already visible to the caller.
create or replace function baseline_private.league_board() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cutoff integer:=5; rounds_json jsonb; players_json jsonb;
begin
 if public.is_admin() then cutoff:=7; end if;
 select coalesce(jsonb_agg(jsonb_build_object('round',r.round_number,'event_id',r.event_id,'published_at',r.published_at,'average',r.average,'results',(select jsonb_agg(x||jsonb_build_object('automatic_next_handicap',x->'next_handicap','next_handicap',coalesce((select to_jsonb(o.handicap) from baseline_private.handicap_overrides o where o.user_id=(x->>'user_id')::uuid and o.round_number=r.round_number+1),x->'next_handicap'),'committee_adjusted',exists(select 1 from baseline_private.handicap_overrides o where o.user_id=(x->>'user_id')::uuid and o.round_number=r.round_number+1))) from jsonb_array_elements(r.results) x)) order by r.round_number),'[]') into rounds_json from baseline_private.league_rounds r where r.round_number<=cutoff and r.published_entries is not null;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'starting_handicap',p.handicap) order by lower(p.full_name)),'[]') into players_json from public.profiles p join public.baseline_member_accounts a on a.user_id=p.id where not a.disabled;
 return jsonb_build_object('players',players_json,'rounds',rounds_json,'visible_rounds',cutoff);
end $$;
