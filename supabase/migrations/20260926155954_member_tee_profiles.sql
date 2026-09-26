-- Isolated member photos; no public URLs or legacy bucket policy changes.
alter table public.profiles add column baseline_avatar_path text;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('baseline-profile-images','baseline-profile-images',false,2097152,array['image/jpeg','image/png','image/webp']);
create policy "Active members read baseline portraits" on storage.objects for select to authenticated using(bucket_id='baseline-profile-images' and (select baseline_private.active_member()));
create policy "Members upload own baseline portrait" on storage.objects for insert to authenticated with check(bucket_id='baseline-profile-images' and (select baseline_private.active_member()) and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Members delete own baseline portrait" on storage.objects for delete to authenticated using(bucket_id='baseline-profile-images' and (select baseline_private.active_member()) and (storage.foldername(name))[1]=(select auth.uid())::text);
create function baseline_private.guard_avatar() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.baseline_avatar_path is not null and (new.baseline_avatar_path !~ ('^'||new.id::text||'/[a-f0-9-]+\.(jpg|png|webp)$') or not exists(select 1 from storage.objects where bucket_id='baseline-profile-images' and name=new.baseline_avatar_path)) then raise exception 'Upload your own profile photo before saving it'; end if;
 return new;
end $$;
create trigger baseline_guard_avatar before insert or update of baseline_avatar_path on public.profiles for each row execute function baseline_private.guard_avatar();
revoke all on function baseline_private.guard_avatar() from public,anon,authenticated;

create function baseline_private.event_tee_groups(event bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ev public.baseline_events; groups_json jsonb; secret boolean; provisional boolean;
begin
 if not baseline_private.active_member() then raise exception 'Member sign-in required'; end if;
 select * into ev from public.baseline_events where id=event;
 if ev.id is null then raise exception 'Event not found'; end if;
 if ev.cancelled or ev.tee_times_dirty then return jsonb_build_object('status',case when ev.cancelled then 'cancelled' else 'reviewing' end,'groups','[]'::jsonb); end if;
 secret:=ev.round_number>=7 and not public.is_admin();
 provisional:=exists(select 1 from generate_series(1,ev.round_number-1) n where not exists(select 1 from baseline_private.league_rounds r where r.round_number=n and r.published_entries is not null));
 select coalesce(jsonb_agg(jsonb_build_object('group_number',t.group_number,'tee_time',t.tee_time,'players',(
  select coalesce(jsonb_agg(jsonb_build_object('user_id',p.id,'name',p.full_name,'avatar_path',p.baseline_avatar_path,'handicap',case when secret then null else coalesce((
   select (x->>'next_handicap')::numeric from baseline_private.league_rounds r cross join lateral jsonb_array_elements(r.results) x
   where r.published_entries is not null and r.round_number<ev.round_number and x->>'user_id'=p.id::text order by r.round_number desc limit 1
  ),p.handicap) end,'handicap_secret',coalesce(secret,false),'type',a.value->>'type') order by a.ordinality),'[]'::jsonb)
  from jsonb_array_elements(t.players) with ordinality a(value,ordinality) join public.profiles p on p.id::text=a.value->>'user_id' join public.baseline_member_accounts m on m.user_id=p.id and not m.disabled
 )) order by t.group_number),'[]'::jsonb) into groups_json from public.baseline_tee_times t where t.event_id=event;
 return jsonb_build_object('status',case when jsonb_array_length(groups_json)=0 then 'unpublished' else 'published' end,'round_number',ev.round_number,'provisional',case when secret then false else provisional end,'groups',groups_json);
end $$;
create function public.baseline_event_tee_groups(event bigint) returns jsonb language sql stable security invoker set search_path='' as $$select baseline_private.event_tee_groups(event);$$;
revoke all on function baseline_private.event_tee_groups(bigint),public.baseline_event_tee_groups(bigint) from public,anon,authenticated;
grant execute on function baseline_private.event_tee_groups(bigint),public.baseline_event_tee_groups(bigint) to authenticated;
