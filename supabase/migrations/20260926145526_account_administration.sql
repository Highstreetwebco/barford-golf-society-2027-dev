-- Dedicated administration for the isolated 2027 member roster.
create unique index baseline_member_name_folded on public.baseline_members(lower(trim(name)));
create function baseline_private.admin_accounts()
returns table(id uuid,username text,mobile text,handicap numeric,is_admin boolean,disabled boolean,member_id uuid,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 return query select p.id,p.full_name,p.phone,p.handicap,p.is_admin,coalesce(a.disabled,false),a.member_id,p.created_at
 from public.profiles p left join public.baseline_member_accounts a on a.user_id=p.id order by lower(p.full_name);
end $$;
create function public.baseline_admin_accounts() returns table(id uuid,username text,mobile text,handicap numeric,is_admin boolean,disabled boolean,member_id uuid,created_at timestamptz)
language sql stable security invoker set search_path='' as $$select * from baseline_private.admin_accounts();$$;
revoke all on function baseline_private.admin_accounts(),public.baseline_admin_accounts() from public,anon;
grant execute on function baseline_private.admin_accounts(),public.baseline_admin_accounts() to authenticated;

create function baseline_private.admin_save_account(target uuid,username text,mobile text,society_handicap numeric,admin_access boolean)
returns void language plpgsql security definer set search_path='' as $$
declare person public.profiles; roster uuid; old_admin boolean;
begin
 perform pg_advisory_xact_lock(2027,401);
 if auth.uid() is null or not public.is_admin() then raise exception 'Organiser access required'; end if;
 select * into person from public.profiles where id=target for update;
 if person.id is null then raise exception 'Account not found'; end if;
 if admin_access is null then raise exception 'Choose the account role'; end if;
 if person.is_admin and not admin_access and target=auth.uid() then raise exception 'You cannot remove your own admin access'; end if;
 if person.is_admin and not admin_access and (select count(*) from public.profiles where is_admin)<=1 then raise exception 'The final administrator cannot be removed'; end if;
 if length(trim(coalesce(username,''))) not between 2 and 150 or username ~ '[[:cntrl:]]' then raise exception 'Enter a valid username'; end if;
 if mobile is null or mobile !~ '^\+?[0-9 ()-]{10,25}$' or length(regexp_replace(mobile,'[^0-9]','','g')) not between 10 and 15 then raise exception 'Enter a valid mobile number'; end if;
 if society_handicap is not null and (society_handicap::text in ('NaN','Infinity','-Infinity') or society_handicap<0 or society_handicap>54 or round(society_handicap,1)<>society_handicap) then raise exception 'Handicap must be 0 to 54, with at most one decimal place'; end if;
 select member_id into roster from public.baseline_member_accounts where user_id=target and not disabled;
 if roster is null then raise exception 'This account has no active roster name. Resolve its name claim first'; end if;
 if exists(select 1 from public.baseline_members where id<>roster and lower(trim(name))=lower(trim(username))) then raise exception 'That username is already in use'; end if;
 update public.baseline_members set name=trim(username) where id=roster;
 update public.profiles set full_name=trim(username),phone=trim(mobile),handicap=society_handicap,is_admin=admin_access,updated_at=now() where id=target;
 update public.baseline_rsvps set name=trim(username) where user_id=target;
 update public.baseline_trip_votes set name=trim(username) where user_id=target;
 update public.baseline_tee_times t set players=(select jsonb_agg(case when p.value->>'user_id'=target::text then p.value||jsonb_build_object('name',trim(username)) else p.value end order by p.ordinality) from jsonb_array_elements(t.players) with ordinality p(value,ordinality)) where t.players @> jsonb_build_array(jsonb_build_object('user_id',target::text));
 if person.is_admin is distinct from admin_access then insert into public.admin_role_audit(changed_by,member_id,granted) values(auth.uid(),target,admin_access); end if;
end $$;
create function public.baseline_admin_save_account(target uuid,username text,mobile text,society_handicap numeric,admin_access boolean)
returns void language sql security invoker set search_path='' as $$select baseline_private.admin_save_account(target,username,mobile,society_handicap,admin_access);$$;
revoke all on function baseline_private.admin_save_account(uuid,text,text,numeric,boolean),public.baseline_admin_save_account(uuid,text,text,numeric,boolean) from public,anon;
grant execute on function baseline_private.admin_save_account(uuid,text,text,numeric,boolean),public.baseline_admin_save_account(uuid,text,text,numeric,boolean) to authenticated;

-- Protect the final administrator through all profile-update routes, including older RPCs.
create function baseline_private.protect_admin_continuity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.is_admin and not new.is_admin then
  perform pg_advisory_xact_lock(2027,401);
  if auth.uid()=old.id then raise exception 'You cannot remove your own admin access'; end if;
  if (select count(*) from public.profiles where is_admin)<=1 then raise exception 'The final administrator cannot be removed'; end if;
 end if;
 return new;
end $$;
revoke all on function baseline_private.protect_admin_continuity() from public,anon,authenticated;
create trigger baseline_admin_continuity before update of is_admin on public.profiles for each row execute function baseline_private.protect_admin_continuity();

-- Deleted/reset accounts must not retain member read access while old JWTs expire.
create function baseline_private.active_member() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles p join public.baseline_member_accounts a on a.user_id=p.id where p.id=auth.uid() and not a.disabled);
$$;
revoke all on function baseline_private.active_member() from public,anon;
grant execute on function baseline_private.active_member() to authenticated;
alter policy "Members read event responses" on public.baseline_rsvps using((select baseline_private.active_member()));
alter policy "Members read trip responses" on public.baseline_trip_votes using((select baseline_private.active_member()));
alter policy "Members read tee times" on public.baseline_tee_times using((select baseline_private.active_member()));
