-- Private portrait references for roster members who have not registered yet.
create table baseline_private.member_portraits (
 member_id uuid primary key references public.baseline_members(id) on delete cascade,
 avatar_path text not null unique,
 updated_at timestamptz not null default now()
);
alter table baseline_private.member_portraits enable row level security;
revoke all on baseline_private.member_portraits from public,anon,authenticated;

create policy "Admins upload roster portraits" on storage.objects for insert to authenticated
with check(bucket_id='baseline-profile-images' and (select public.is_admin()) and exists(
 select 1 from public.baseline_members m where m.id::text=(storage.foldername(storage.objects.name))[1]
 and not m.invite_only and not exists(select 1 from public.baseline_member_accounts a where a.member_id=m.id and a.disabled)));
create policy "Admins delete roster portraits" on storage.objects for delete to authenticated
using(bucket_id='baseline-profile-images' and (select public.is_admin()) and exists(
 select 1 from public.baseline_members m where m.id::text=(storage.foldername(storage.objects.name))[1]
 and not m.invite_only and not exists(select 1 from public.baseline_member_accounts a where a.member_id=m.id and a.disabled)));
create policy "Members delete inherited roster portraits" on storage.objects for delete to authenticated
using(bucket_id='baseline-profile-images' and (select baseline_private.active_member()) and exists(
 select 1 from public.baseline_member_accounts a where a.user_id=(select auth.uid()) and not a.disabled
 and a.member_id::text=(storage.foldername(storage.objects.name))[1]));

-- A registered member may retain a portrait uploaded to their roster folder.
create or replace function baseline_private.guard_avatar()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.baseline_avatar_path is not null and (
  new.baseline_avatar_path !~ '^[a-f0-9-]+/[a-f0-9-]+\.(jpg|png|webp)$'
  or not exists(select 1 from storage.objects where bucket_id='baseline-profile-images' and name=new.baseline_avatar_path)
  or (split_part(new.baseline_avatar_path,'/',1)<>new.id::text and not exists(
   select 1 from public.baseline_member_accounts a where a.user_id=new.id and not a.disabled
   and a.member_id::text=split_part(new.baseline_avatar_path,'/',1)))
 ) then raise exception 'Upload your own profile photo before saving it'; end if;
 return new;
end $$;

create function baseline_private.admin_member_photo(target uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare account_id uuid; path text;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 if not exists(select 1 from public.baseline_members where id=target) then raise exception 'Member not found'; end if;
 if exists(select 1 from public.baseline_member_accounts where member_id=target and disabled) then raise exception 'Active member required'; end if;
 select user_id into account_id from public.baseline_member_accounts where member_id=target and not disabled;
 if account_id is null then
  if exists(select 1 from public.baseline_members where id=target and invite_only) then raise exception 'Active member required'; end if;
  select avatar_path into path from baseline_private.member_portraits where member_id=target;
 else
  select baseline_avatar_path into path from public.profiles where id=account_id;
 end if;
 return jsonb_build_object('avatar_path',path,'upload_folder',coalesce(account_id,target));
end $$;
create function public.baseline_admin_member_photo(target uuid)
returns jsonb language sql stable security invoker set search_path='' as $$select baseline_private.admin_member_photo(target);$$;
revoke all on function baseline_private.admin_member_photo(uuid),public.baseline_admin_member_photo(uuid) from public,anon;
grant execute on function baseline_private.admin_member_photo(uuid),public.baseline_admin_member_photo(uuid) to authenticated;

create function baseline_private.admin_save_member_photo(target uuid,photo_path text,expected_path text)
returns void language plpgsql security definer set search_path='' as $$
declare account_id uuid; current_path text; snapshot jsonb;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 perform pg_advisory_xact_lock(2027,501);
 perform 1 from public.baseline_members where id=target for update;
 snapshot:=baseline_private.admin_member_photo(target);
 select user_id into account_id from public.baseline_member_accounts where member_id=target and not disabled;
 if account_id is null then
  select avatar_path into current_path from baseline_private.member_portraits where member_id=target for update;
 else
  select baseline_avatar_path into current_path from public.profiles where id=account_id for update;
 end if;
 if current_path is distinct from expected_path then raise exception 'This photo changed. Reopen the photo editor before saving'; end if;
 if photo_path is not null and (photo_path !~ '^[a-f0-9-]+/[a-f0-9-]+\.(jpg|png|webp)$' or not exists(
  select 1 from storage.objects where bucket_id='baseline-profile-images' and name=photo_path
  and (split_part(name,'/',1)=target::text or split_part(name,'/',1)=account_id::text)
 )) then raise exception 'Upload a photo for this member first'; end if;
 if account_id is not null then
  update public.profiles set baseline_avatar_path=photo_path,updated_at=now() where id=account_id;
 elsif photo_path is null then
  delete from baseline_private.member_portraits where member_id=target;
 else
  insert into baseline_private.member_portraits(member_id,avatar_path) values(target,photo_path)
  on conflict(member_id) do update set avatar_path=excluded.avatar_path,updated_at=now();
 end if;
 insert into baseline_private.operation_audit(actor,action,details) values(auth.uid(),'member_photo',
  jsonb_build_object('member_id',target,'user_id',account_id,'previous_path',current_path,'photo_path',photo_path));
end $$;
create function public.baseline_admin_save_member_photo(target uuid,photo_path text,expected_path text)
returns void language sql security invoker set search_path='' as $$select baseline_private.admin_save_member_photo(target,photo_path,expected_path);$$;
revoke all on function baseline_private.admin_save_member_photo(uuid,text,text),public.baseline_admin_save_member_photo(uuid,text,text) from public,anon;
grant execute on function baseline_private.admin_save_member_photo(uuid,text,text),public.baseline_admin_save_member_photo(uuid,text,text) to authenticated;

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

