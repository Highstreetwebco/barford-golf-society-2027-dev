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

