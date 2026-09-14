-- Live scoring and database hardening, refreshed 14 Sep 2026.
revoke execute on all functions in schema public from anon;

-- PUBLIC is the source of PostgreSQL's default function execution privilege,
-- so explicitly remove it from member RPCs and grant only authenticated access.
revoke execute on function public.get_event_availability(uuid) from public, anon;
grant execute on function public.get_event_availability(uuid) to authenticated;
revoke execute on function public.get_event_playing_list(uuid) from public, anon;
grant execute on function public.get_event_playing_list(uuid) to authenticated;
revoke execute on function public.get_event_rsvp_lock_status(uuid) from public, anon;
grant execute on function public.get_event_rsvp_lock_status(uuid) to authenticated;
revoke execute on function public.get_event_rsvp_roster(uuid) from public, anon;
grant execute on function public.get_event_rsvp_roster(uuid) to authenticated;
revoke execute on function public.get_event_tee_times(uuid) from public, anon;
grant execute on function public.get_event_tee_times(uuid) to authenticated;
revoke execute on function public.get_my_unseen_rsvp_promotions() from public, anon;
grant execute on function public.get_my_unseen_rsvp_promotions() to authenticated;
revoke execute on function public.mark_my_rsvp_promotion_seen(uuid) from public, anon;
grant execute on function public.mark_my_rsvp_promotion_seen(uuid) to authenticated;
revoke execute on function public.next_eligible_round() from public, anon;
grant execute on function public.next_eligible_round() to authenticated;
revoke execute on function public.set_my_event_rsvp(uuid,text,boolean,text) from public, anon;
grant execute on function public.set_my_event_rsvp(uuid,text,boolean,text) to authenticated;

-- Trigger-only functions are never callable browser endpoints.
revoke execute on function public.lock_member_rsvp_choices_after_tee_times() from public, anon, authenticated;
revoke execute on function public.promote_next_event_reserve() from public, anon, authenticated;
revoke execute on function public.promote_reserve_after_delete() from public, anon, authenticated;
revoke execute on function public.protect_profile_admin_flag() from public, anon, authenticated;
revoke execute on function public.sync_event_result_workflow() from public, anon, authenticated;
revoke execute on function public.sync_event_round() from public, anon, authenticated;
revoke execute on function public.create_profile_for_new_user() from public, anon, authenticated;

revoke all on table public.integration_secrets from anon, authenticated;
revoke all on table public.passkey_credentials from anon, authenticated;
revoke all on table public.passkey_challenges from anon, authenticated;

create index if not exists event_scorecard_players_member_id_idx on public.event_scorecard_players(member_id);
create index if not exists event_scorecards_scorer_id_idx on public.event_scorecards(scorer_id);
create index if not exists idx_course_scorecards_verified_by on public.course_scorecards(verified_by);
create index if not exists idx_events_course_scorecard_id on public.events(course_scorecard_id);

drop policy if exists course_hole_maps_admin_write on public.course_hole_maps;
create policy course_hole_maps_admin_insert on public.course_hole_maps for insert to authenticated with check ((select public.is_admin()));
create policy course_hole_maps_admin_update on public.course_hole_maps for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy course_hole_maps_admin_delete on public.course_hole_maps for delete to authenticated using ((select public.is_admin()));

alter default privileges for role postgres in schema public revoke execute on functions from public, anon;
notify pgrst, 'reload schema';
