CREATE OR REPLACE FUNCTION baseline_private.attach_member_bookings(who uuid, account_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ev record; start_h numeric;
begin
 if not exists(select 1 from public.baseline_member_accounts where member_id=who and user_id=account_id and not disabled) then raise exception 'Member account does not match'; end if;
 perform pg_advisory_xact_lock(2027,501);
 -- Keep an organiser-added portrait when this roster member creates a login.
 update public.profiles p set baseline_avatar_path=mp.avatar_path
 from baseline_private.member_portraits mp where mp.member_id=who and p.id=account_id and p.baseline_avatar_path is null;
 delete from baseline_private.member_portraits where member_id=who;
 -- Registration supplies a valid mobile number on the linked profile.
 delete from baseline_private.member_contacts where member_id=who;
 -- Preserve the organiser-set starting handicap even if no event was booked yet.
 if not exists(select 1 from public.baseline_rsvps where member_id=who and user_id is null) then
  select starting_handicap into start_h from public.baseline_members where id=who;
  if start_h is not null then update public.profiles set handicap=start_h where id=account_id; end if;
  return;
 end if;
 for ev in select e.id from public.baseline_events e where exists(select 1 from public.baseline_rsvps r where r.event_id=e.id and r.member_id=who and r.user_id is null) order by e.id for update loop
  if exists(select 1 from public.baseline_rsvps where event_id=ev.id and user_id=account_id) then raise exception 'An existing booking needs organiser help before linking this name'; end if;
 end loop;
 update public.baseline_rsvps set user_id=account_id,attending=attending,updated_at=now() where member_id=who and user_id is null;
 insert into public.baseline_rsvp_contacts(rsvp_id,phone)
 select r.id,p.phone from public.baseline_rsvps r join public.profiles p on p.id=r.user_id
 where r.member_id=who and r.user_id=account_id and length(trim(p.phone)) between 5 and 40
 on conflict(rsvp_id) do update set phone=excluded.phone;
 update public.baseline_tee_times t set players=(select jsonb_agg(case when p->>'member_id'=who::text and p->>'user_id' is null
  then p||jsonb_build_object('user_id',account_id,'participant_id',account_id) else p end order by ord)
  from jsonb_array_elements(t.players) with ordinality a(p,ord))
 where t.players @> jsonb_build_array(jsonb_build_object('member_id',who));
 update baseline_private.league_rounds r set
  draft=(select coalesce(jsonb_agg(case when x->>'user_id'=who::text then x||jsonb_build_object('user_id',account_id) else x end order by ord),'[]'::jsonb) from jsonb_array_elements(r.draft) with ordinality a(x,ord)),
  published_entries=(select jsonb_agg(case when x->>'user_id'=who::text then x||jsonb_build_object('user_id',account_id) else x end order by ord) from jsonb_array_elements(r.published_entries) with ordinality a(x,ord)),
  results=(select coalesce(jsonb_agg(case when x->>'user_id'=who::text then x||jsonb_build_object('user_id',account_id) else x end order by ord),'[]'::jsonb) from jsonb_array_elements(r.results) with ordinality a(x,ord)),
  winner=case when r.winner=who then account_id else r.winner end,
  draft_winner=case when r.draft_winner=who then account_id else r.draft_winner end
 where r.draft @> jsonb_build_array(jsonb_build_object('user_id',who))
    or r.published_entries @> jsonb_build_array(jsonb_build_object('user_id',who))
    or r.results @> jsonb_build_array(jsonb_build_object('user_id',who));
 select starting_handicap into start_h from public.baseline_members where id=who;
 if start_h is not null then update public.profiles set handicap=start_h where id=account_id; end if;
 perform baseline_private.league_rebuild();
 update baseline_private.league_state set revision=revision+1 where id=true;
end $function$;

CREATE OR REPLACE FUNCTION baseline_private.event_tee_groups(event bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ev public.baseline_events; groups_json jsonb; secret boolean; provisional boolean;
begin
 if not baseline_private.active_member() then raise exception 'Member sign-in required'; end if;
 select * into ev from public.baseline_events where id=event;
 if ev.id is null then raise exception 'Event not found'; end if;
 if ev.cancelled or ev.tee_times_dirty then return jsonb_build_object('status',case when ev.cancelled then 'cancelled' else 'reviewing' end,'groups','[]'::jsonb); end if;
 secret:=ev.round_number>=7 and not public.is_admin();
 provisional:=exists(select 1 from generate_series(1,ev.round_number-1) n where not exists(select 1 from baseline_private.league_rounds r where r.round_number=n and r.published_entries is not null));
 select coalesce(jsonb_agg(jsonb_build_object('group_number',t.group_number,'tee_time',t.tee_time,'players',(
  select coalesce(jsonb_agg(jsonb_build_object('participant_id',coalesce(a.value->>'participant_id',a.value->>'user_id'),'user_id',p.id,'name',coalesce(p.full_name,r.name)||case when exists(select 1 from public.baseline_rsvps gr where gr.event_id=event and gr.user_id=p.id and gr.guest_host_id is not null) then ' (guest)' else '' end,'avatar_path',case when r.user_id is null then mp.avatar_path else p.baseline_avatar_path end,'handicap',case when secret then null else baseline_private.handicap_at(r.participant_id,coalesce(ev.round_number,1)) end,'handicap_secret',coalesce(secret,false),'type',a.value->>'type') order by a.ordinality),'[]'::jsonb)
  from jsonb_array_elements(t.players) with ordinality a(value,ordinality) join public.baseline_rsvps r on r.event_id=event and r.participant_id::text=coalesce(a.value->>'participant_id',a.value->>'user_id') left join public.profiles p on p.id=r.user_id left join baseline_private.member_portraits mp on mp.member_id=r.member_id left join public.baseline_member_accounts m on m.user_id=p.id where not coalesce(m.disabled,false)
 )) order by t.group_number),'[]'::jsonb) into groups_json from public.baseline_tee_times t where t.event_id=event;
 return jsonb_build_object('status',case when jsonb_array_length(groups_json)=0 then 'unpublished' else 'published' end,'published_at',ev.tee_published_at,'revision',ev.tee_revision,'round_number',ev.round_number,'provisional',case when secret then false else provisional end,'groups',groups_json);
end $function$;

notify pgrst, 'reload schema';

