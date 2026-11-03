-- Event edits and existing tee times are one atomic write. Never regenerate players.
create or replace function baseline_private.operations_event_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 sheet boolean; g record; p jsonb; first_minutes integer; start_minutes integer;
 next_minutes integer; offset_minutes integer; n integer:=0; next_time text;
begin
 if new.rsvp_deadline>new.date or new.cancellation_deadline>new.date then
  raise exception 'RSVP and cancellation deadlines must be on or before the event. Update the dates in Optional details.';
 end if;
 if new.guest_price<0 then raise exception 'Guest price cannot be negative'; end if;
 if tg_op='UPDATE' then
  if new.max_players is not null and new.max_players is distinct from old.max_players
   and new.max_players<(select count(*) from public.baseline_rsvps where event_id=new.id and attending and not reserve)
  then raise exception 'Maximum players cannot be less than the confirmed player count'; end if;
  -- Golf formats can change without losing bookings. A social conversion changes
  -- booking semantics and cannot silently remove an existing golf event.
  if new.event_type is distinct from old.event_type and (new.event_type='social' or old.event_type='social')
   and (exists(select 1 from public.baseline_rsvps where event_id=new.id)
     or exists(select 1 from public.baseline_tee_times where event_id=new.id))
  then raise exception 'A booked golf event cannot be converted to or from a social event. Its date, times, venue and other details can still be edited'; end if;
  select exists(select 1 from public.baseline_tee_times where event_id=new.id) into sheet;
  if sheet and new.cancelled is distinct from old.cancelled then new.tee_times_dirty:=true; end if;
  -- Publishing a complete tee sheet increments its revision itself. That path
  -- synchronises the event start from the sheet and must not retime it again.
  if sheet and new.tee_revision=old.tee_revision
   and (new.first_time is distinct from old.first_time or new.tee_interval is distinct from old.tee_interval) then
   if new.first_time is null or new.first_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'
   then raise exception 'Enter a valid first tee time while tee groups exist'; end if;
   if new.tee_interval is null or new.tee_interval not between 1 and 60 then raise exception 'Enter a tee gap from 1 to 60 minutes'; end if;
   if exists(select 1 from public.baseline_tee_times where event_id=new.id and (tee_time is null or tee_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'))
   then raise exception 'An existing group has no valid time. Set its time in Tee times before moving the event start'; end if;
   select extract(epoch from tee_time::time)::integer/60 into first_minutes
    from public.baseline_tee_times where event_id=new.id order by group_number limit 1;
   start_minutes:=extract(epoch from new.first_time::time)::integer/60;
   offset_minutes:=start_minutes-first_minutes;
   new.tee_revision:=old.tee_revision+1;
   if old.tee_published_at is not null then new.tee_published_at:=now(); end if;
   for g in select * from public.baseline_tee_times where event_id=new.id order by group_number for update loop
    if new.tee_interval is distinct from old.tee_interval then next_minutes:=start_minutes+n*new.tee_interval;
    else next_minutes:=extract(epoch from g.tee_time::time)::integer/60+offset_minutes; end if;
    if next_minutes not between 0 and 1439 then raise exception 'These tee times would run into another day. Use an earlier start or shorter gap'; end if;
    next_time:=lpad((next_minutes/60)::text,2,'0')||':'||lpad((next_minutes%60)::text,2,'0');
    if left(g.tee_time,5)<>next_time then
     update public.baseline_tee_times set tee_time=next_time where id=g.id;
     if old.tee_published_at is not null then
      for p in select value from jsonb_array_elements(g.players) loop
       if p->>'user_id' is not null then
        insert into baseline_private.tee_changes(event_id,user_id,old_time,new_time,revision)
        values(new.id,(p->>'user_id')::uuid,g.tee_time,next_time,new.tee_revision);
       end if;
      end loop;
     end if;
    end if;
    n:=n+1;
   end loop;
   -- Preserve any pre-existing player-list warning; a time edit cannot resolve it.
   new.tee_times_dirty:=new.tee_times_dirty or old.tee_times_dirty;
  end if;
 end if;
 return new;
end $$;

-- Raising capacity only invalidates groups if a waiting player actually joins.
create or replace function baseline_private.operations_event_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare occupied integer; candidate record; promoted boolean:=false;
begin
 if new.max_players is distinct from old.max_players
  and (new.max_players is null or new.max_players>coalesce(old.max_players,0)) and not new.cancelled then
  select count(*) into occupied from public.baseline_rsvps where event_id=new.id and attending and not reserve;
  for candidate in select id from public.baseline_rsvps where event_id=new.id and reserve order by requested_at,id loop
   exit when new.max_players is not null and occupied>=new.max_players;
   update public.baseline_rsvps set attending=true,reserve=false,updated_at=now() where id=candidate.id;
   occupied:=occupied+1; promoted:=true;
  end loop;
  if promoted and exists(select 1 from public.baseline_tee_times where event_id=new.id) then
   update public.baseline_events set tee_times_dirty=true where id=new.id;
  end if;
 end if;
 return new;
end $$;
revoke all on function baseline_private.operations_event_guard(),baseline_private.operations_event_changed() from public,anon,authenticated;

-- Preserve the existing pairing, membership and notification checks on publication.
CREATE OR REPLACE FUNCTION baseline_private.save_tee_times(event bigint, groups jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare last_time text; g jsonb; player jsonb; roster jsonb; r public.baseline_rsvps; seen uuid[]:='{}'; n integer:=0; uid uuid; previous jsonb; changed record;
begin
 if not public.is_admin() then raise exception 'Organiser access required'; end if;
 perform 1 from public.baseline_events where id=event for update;
 if not found then raise exception 'Event not found'; end if;
 if jsonb_typeof(groups) is distinct from 'array' then raise exception 'Invalid tee groups'; end if;
 if exists(select 1 from public.baseline_events where id=event and (event_type='social' or cancelled)) then raise exception 'Tee groups are only available for active golf events'; end if;
 select coalesce(jsonb_object_agg(coalesce(p->>'participant_id',p->>'user_id'),jsonb_build_object('time',t.tee_time,'group',t.group_number,'players',t.players)),'{}') into previous from public.baseline_tee_times t cross join lateral jsonb_array_elements(t.players) p where t.event_id=event;
 delete from public.baseline_tee_times where event_id=event;
 for g in select value from jsonb_array_elements(groups) loop
  if g->>'time' is null or g->>'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Enter a valid tee time'; end if;
  if last_time is not null and g->>'time'<=last_time then raise exception 'Each group must tee off after the previous group'; end if;
  last_time:=g->>'time';
  if jsonb_typeof(g->'players') is distinct from 'array' or jsonb_array_length(g->'players') not between 1 and 4 then raise exception 'Each group needs one to four players'; end if;
  roster:='[]'::jsonb;
  for player in select value from jsonb_array_elements(g->'players') loop
   uid:=(player#>>'{}')::uuid;
   if uid=any(seen) then raise exception 'A player appears more than once'; end if;
   select * into r from public.baseline_rsvps where event_id=event and participant_id=uid and attending and not reserve;
   if r.id is null then raise exception 'A player is no longer confirmed. Reload RSVPs'; end if;
   seen:=array_append(seen,uid);
   roster:=roster||jsonb_build_array(jsonb_build_object('participant_id',uid,'user_id',r.user_id,'member_id',r.member_id,'name',r.name,'type',case when r.buggy then 'buggy' else 'walker' end));
  end loop;
  n:=n+1;
  insert into public.baseline_tee_times(event_id,group_number,tee_time,players) values(event,n,g->>'time',roster);
 end loop;
 if cardinality(seen)<>(select count(*) from public.baseline_rsvps where event_id=event and attending and not reserve) then
  raise exception 'Include every confirmed player before publishing';
 end if;
 if exists(select 1 from baseline_private.playing_pairs p where p.event_id=event and p.status='confirmed' and not exists(select 1 from public.baseline_tee_times t where t.event_id=event and t.players @> jsonb_build_array(jsonb_build_object('user_id',p.first_user),jsonb_build_object('user_id',p.second_user)))) then raise exception 'Keep confirmed playing partners in the same tee group'; end if;
 if exists(select 1 from public.baseline_rsvps guest where guest.event_id=event and guest.attending and not guest.reserve and guest.guest_host_id is not null and not exists(
  select 1 from public.baseline_tee_times t where t.event_id=event
  and exists(select 1 from jsonb_array_elements(t.players) p where coalesce(p->>'participant_id',p->>'user_id')=guest.participant_id::text)
  and exists(select 1 from jsonb_array_elements(t.players) p where coalesce(p->>'participant_id',p->>'user_id')=guest.guest_host_id::text)
 )) then raise exception 'Keep every guest with their inviting member. Confirm the host is playing and put them in the same group'; end if;
 -- The event start always matches its first published group, including manual edits.
 update public.baseline_events set tee_revision=tee_revision+1,tee_published_at=now(),
 first_time=groups->0->>'time',
 tee_interval=case when jsonb_array_length(groups)>1 and not exists(
   select 1 from jsonb_array_elements(groups) with ordinality a(value,n)
   join jsonb_array_elements(groups) with ordinality z(value,n) on z.n=a.n+1
   where extract(epoch from (z.value->>'time')::time-(a.value->>'time')::time)/60
    <>extract(epoch from (groups->1->>'time')::time-(groups->0->>'time')::time)/60
 ) and extract(epoch from (groups->1->>'time')::time-(groups->0->>'time')::time)/60 between 1 and 60
 then (extract(epoch from (groups->1->>'time')::time-(groups->0->>'time')::time)/60)::integer else tee_interval end
 where id=event;
 for changed in select (p->>'user_id')::uuid uid,t.tee_time,t.group_number,t.players from public.baseline_tee_times t cross join lateral jsonb_array_elements(t.players) p where t.event_id=event and p->>'user_id' is not null loop
 if previous ? changed.uid::text and previous->changed.uid::text is distinct from jsonb_build_object('time',changed.tee_time,'group',changed.group_number,'players',changed.players) then
 insert into baseline_private.tee_changes(event_id,user_id,old_time,new_time,revision) values(event,changed.uid,previous->changed.uid::text->>'time',changed.tee_time,(select tee_revision from public.baseline_events where id=event)); end if;
 end loop;
 -- Pair buggy players within their published group. Preserve a booking owner only when the same pair remains.
 with numbered as (
 select t.group_number,(p.value->>'user_id')::uuid as uid,row_number() over(partition by t.group_number order by p.ordinality) as rn
 from public.baseline_tee_times t cross join lateral jsonb_array_elements(t.players) with ordinality p(value,ordinality)
 where t.event_id=event and p.value->>'type'='buggy'
 ), pairs as (select least(a.uid,b.uid) u1,greatest(a.uid,b.uid) u2 from numbered a join numbered b on b.group_number=a.group_number and b.rn=a.rn+1 where a.rn%2=1 and a.uid is not null and b.uid is not null)
 delete from public.baseline_buggy_pairs bp where bp.event_id=event and not exists(select 1 from pairs p where p.u1=bp.first_user and p.u2=bp.second_user);
 with numbered as (
 select t.group_number,(p.value->>'user_id')::uuid as uid,row_number() over(partition by t.group_number order by p.ordinality) as rn
 from public.baseline_tee_times t cross join lateral jsonb_array_elements(t.players) with ordinality p(value,ordinality)
 where t.event_id=event and p.value->>'type'='buggy'
 ) insert into public.baseline_buggy_pairs(event_id,first_user,second_user)
 select event,least(a.uid,b.uid),greatest(a.uid,b.uid) from numbered a join numbered b on b.group_number=a.group_number and b.rn=a.rn+1 where a.rn%2=1 and a.uid is not null and b.uid is not null on conflict(event_id,first_user,second_user) do nothing;
 update public.baseline_events set tee_times_dirty=false where id=event;
end $function$;


create or replace function baseline_private.admin_member_photo(target uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare account_id uuid; path text;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 if not exists(select 1 from public.baseline_members where id=target) then raise exception 'Member not found'; end if;
 if exists(select 1 from public.baseline_member_accounts where member_id=target and disabled) then raise exception 'Active member required'; end if;
 select user_id into account_id from public.baseline_member_accounts where member_id=target and not disabled;
 if account_id is null then
  select avatar_path into path from baseline_private.member_portraits where member_id=target;
 else
  select baseline_avatar_path into path from public.profiles where id=account_id;
 end if;
 return jsonb_build_object('avatar_path',path,'upload_folder',coalesce(account_id,target));
end $$;
