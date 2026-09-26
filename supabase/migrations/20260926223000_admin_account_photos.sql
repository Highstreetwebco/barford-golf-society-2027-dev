-- Organisers can upload portraits for claimed members without sharing service credentials.
create policy "Admins upload member portraits" on storage.objects for insert to authenticated
with check (bucket_id='baseline-profile-images' and (select public.is_admin())
  and exists (select 1 from public.baseline_member_accounts a
    where a.user_id::text=(storage.foldername(name))[1] and not a.disabled));
create policy "Admins delete member portraits" on storage.objects for delete to authenticated
using (bucket_id='baseline-profile-images' and (select public.is_admin())
  and exists (select 1 from public.baseline_member_accounts a
    where a.user_id::text=(storage.foldername(name))[1] and not a.disabled));

create function baseline_private.admin_account_photos()
returns table(id uuid,avatar_path text) language sql stable security definer set search_path='' as $$
 select p.id,p.baseline_avatar_path from public.profiles p
 where auth.uid() is not null and public.is_admin();
$$;
create function public.baseline_admin_account_photos()
returns table(id uuid,avatar_path text) language sql stable security invoker set search_path='' as $$
 select * from baseline_private.admin_account_photos();
$$;
revoke all on function baseline_private.admin_account_photos(),public.baseline_admin_account_photos() from public,anon;
grant execute on function baseline_private.admin_account_photos(),public.baseline_admin_account_photos() to authenticated;

create function baseline_private.admin_set_account_photo(target uuid,photo_path text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 if not exists(select 1 from public.baseline_member_accounts where user_id=target and not disabled)
 then raise exception 'Active account required'; end if;
 if photo_path is not null and not exists (
   select 1 from storage.objects where bucket_id='baseline-profile-images'
   and name=photo_path and split_part(name,'/',1)=target::text
 ) then raise exception 'Upload the photo to this account first'; end if;
 update public.profiles set baseline_avatar_path=photo_path,updated_at=now() where id=target;
end $$;
create function public.baseline_admin_set_account_photo(target uuid,photo_path text)
returns void language sql security invoker set search_path='' as $$
 select baseline_private.admin_set_account_photo(target,photo_path);
$$;
revoke all on function baseline_private.admin_set_account_photo(uuid,text),public.baseline_admin_set_account_photo(uuid,text) from public,anon;
grant execute on function baseline_private.admin_set_account_photo(uuid,text),public.baseline_admin_set_account_photo(uuid,text) to authenticated;
