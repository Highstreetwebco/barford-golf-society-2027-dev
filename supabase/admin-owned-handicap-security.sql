-- Committee-owned handicaps. Existing values and played-round snapshots are preserved.
create or replace function public.protect_member_handicap()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE' then
    if new.handicap is not distinct from old.handicap then return new; end if;
  elsif new.handicap is null then
    return new;
  end if;
  if current_user not in ('postgres','supabase_admin','service_role') and not public.is_admin() then
    raise exception 'Only the committee can set or change a society handicap.' using errcode='42501';
  end if;
  if new.handicap is not null and (new.handicap::text in ('NaN','Infinity','-Infinity')
     or new.handicap < 0 or new.handicap > 54 or round(new.handicap,1) <> new.handicap) then
    raise exception 'Enter a handicap from 0 to 54, with up to one decimal place.' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_member_handicap() from public,anon,authenticated;
drop trigger if exists protect_member_handicap on public.profiles;
create trigger protect_member_handicap before insert or update of handicap on public.profiles
for each row execute function public.protect_member_handicap();

-- Cached clients receive a clear error rather than retaining a self-service route.
create or replace function public.set_initial_handicap(initial_handicap numeric)
returns numeric language plpgsql security invoker set search_path = ''
as $$ begin raise exception 'The committee will set your society handicap. Please contact an administrator.' using errcode='42501'; end; $$;
revoke all on function public.set_initial_handicap(numeric) from public,anon;
grant execute on function public.set_initial_handicap(numeric) to authenticated;

-- Invoker privileges retain profile RLS. Admin authorization is checked on every save.
create or replace function public.admin_set_member_handicap(target_member_id uuid, new_handicap numeric, expected_handicap numeric)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare saved public.profiles%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access required.' using errcode='42501';
  end if;
  if new_handicap is null or new_handicap::text in ('NaN','Infinity','-Infinity')
     or new_handicap < 0 or new_handicap > 54 or round(new_handicap,1) <> new_handicap then
    raise exception 'Enter a handicap from 0 to 54, with up to one decimal place.' using errcode='22023';
  end if;
  update public.profiles set handicap=new_handicap,updated_at=now()
  where id=target_member_id and handicap is not distinct from expected_handicap
  returning * into saved;
  if not found then raise exception 'This member was updated or removed. Refresh the list before saving.' using errcode='40001'; end if;
  return jsonb_build_object('id',saved.id,'handicap',saved.handicap);
end;
$$;
revoke all on function public.admin_set_member_handicap(uuid,numeric,numeric) from public,anon;
grant execute on function public.admin_set_member_handicap(uuid,numeric,numeric) to authenticated;
