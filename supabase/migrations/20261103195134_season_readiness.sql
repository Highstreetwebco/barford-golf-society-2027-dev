-- The public leaderboard includes registered, active society members only.
-- Offline bookings remain available to organisers through league_participants.
create or replace function baseline_private.league_board()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  cutoff integer := 5;
  rounds_json jsonb;
  players_json jsonb;
  registered_ids uuid[];
begin
  if public.is_admin() then cutoff := 7; end if;
  select coalesce(array_agg(p.id), array[]::uuid[]),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'starting_handicap', p.handicap
    ) order by lower(p.full_name)), '[]'::jsonb)
  into registered_ids, players_json
  from public.profiles p
  join public.baseline_member_accounts a on a.user_id = p.id and not a.disabled
  join public.baseline_members m on m.id = a.member_id and not m.invite_only;

  select coalesce(jsonb_agg(jsonb_build_object(
    'round', r.round_number, 'event_id', r.event_id,
    'published_at', r.published_at, 'average', r.average,
    'results', (
      select coalesce(jsonb_agg(x || jsonb_build_object(
        'automatic_next_handicap', x->'next_handicap',
        'next_handicap', coalesce((
          select to_jsonb(o.handicap) from baseline_private.handicap_overrides o
          where o.user_id = (x->>'user_id')::uuid and o.round_number = r.round_number + 1
        ), x->'next_handicap'),
        'committee_adjusted', exists (
          select 1 from baseline_private.handicap_overrides o
          where o.user_id = (x->>'user_id')::uuid and o.round_number = r.round_number + 1
        )
      )), '[]'::jsonb)
      from jsonb_array_elements(r.results) x
      where (x->>'user_id')::uuid = any(registered_ids)
    )
  ) order by r.round_number), '[]'::jsonb)
  into rounds_json from baseline_private.league_rounds r
  where r.round_number <= cutoff and r.published_entries is not null;
  return jsonb_build_object('players', players_json, 'rounds', rounds_json, 'visible_rounds', cutoff);
end;
$$;

-- A one-time reset backup is private and cannot be read or written by the site.
create table baseline_private.season_reset_archives (
  reset_key text primary key,
  created_at timestamptz not null default now(),
  snapshot jsonb not null
);
alter table baseline_private.season_reset_archives enable row level security;
revoke all on baseline_private.season_reset_archives from public, anon, authenticated;
comment on table baseline_private.season_reset_archives is
  'Restricted recovery snapshots for authorised season resets; no browser access.';
