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


notify pgrst, 'reload schema';
