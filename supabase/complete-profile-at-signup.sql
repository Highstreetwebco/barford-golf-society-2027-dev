-- The committee sets handicaps after signup. Never trust handicap metadata.
CREATE OR REPLACE FUNCTION public.create_profile_for_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  requested_category text := new.raw_user_meta_data->>'playing_category';
  requested_primary text := coalesce(nullif(new.raw_user_meta_data->>'theme_primary',''), '#315C4A');
  requested_accent text := coalesce(nullif(new.raw_user_meta_data->>'theme_accent',''), '#C7A96B');
begin
  if requested_category not in ('men','women') then
    raise exception 'A playing category is required to create a Barford Golf Society account';
  end if;
  if requested_primary !~ '^#[0-9A-Fa-f]{6}$' or requested_accent !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Dashboard colours must be six-digit hex colours';
  end if;

  insert into public.profiles (
    id, full_name, email, phone, playing_category, handicap,
    leaderboard_active, leaderboard_from_round, theme_primary, theme_accent
  )
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'Member'),
    coalesce(new.email, ''),
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    requested_category,
    null,
    true,
    public.next_eligible_round(),
    upper(requested_primary),
    upper(requested_accent)
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;
