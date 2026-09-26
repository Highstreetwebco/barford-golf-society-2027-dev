-- Only for xspzmthygrajzktydvvj. Additive: existing 2027 tables and accounts are untouched.
create schema if not exists baseline_private;
revoke all on schema baseline_private from public, anon;
grant usage on schema baseline_private to authenticated;

create table public.baseline_events (
 id bigint generated always as identity primary key,
 name text not null check (length(name) between 1 and 200),
 location text not null default '', date date not null,
 description text default '', price text, guest_price numeric,
 course_link text default '', weather_link text default '', cancelled boolean not null default false,
 max_players integer check (max_players > 0), first_time text, time text,
 video_type text, video_link text, per_hole_videos jsonb,
 created_at timestamptz not null default now()
);
create table public.baseline_rsvps (
 id bigint generated always as identity primary key,
 event_id bigint not null references public.baseline_events(id) on delete cascade,
 name text not null check (length(name) between 1 and 150),
 attending boolean not null default true, reserve boolean not null default false,
 buggy boolean not null default false, flexibility text, preferred_time text,
 created_at timestamptz not null default now()
);
create index baseline_rsvps_event_idx on public.baseline_rsvps(event_id);
create unique index baseline_rsvp_unique_name on public.baseline_rsvps(event_id,lower(trim(name)));
create table public.baseline_rsvp_contacts (
 rsvp_id bigint primary key references public.baseline_rsvps(id) on delete cascade,
 phone text not null check (length(phone) between 5 and 40),
 whatsapp_opt_in boolean not null default false
);
create table public.baseline_tee_times (
 id bigint generated always as identity primary key,
 event_id bigint not null references public.baseline_events(id) on delete cascade,
 group_number integer not null check (group_number > 0),
 tee_time text not null,
 players jsonb not null default '[]'::jsonb check (jsonb_typeof(players)='array'),
 unique(event_id,group_number)
);
create table public.baseline_players (name text primary key check (length(name) between 1 and 150));
create table public.baseline_scores (
 id bigint generated always as identity primary key,
 player text not null references public.baseline_players(name) on delete cascade,
 round integer not null check(round between 1 and 7),
 handicap numeric, points integer check(points between 0 and 108), adj numeric,
 next_handicap numeric, total integer, winner boolean not null default false,
 unique(player,round)
);
create table public.baseline_products (
 id bigint generated always as identity primary key,
 category text not null default 'balls', name text not null check(length(name) between 1 and 200),
 description text default '', price numeric(10,2) not null check(price>=0),
 packs_left integer not null default 0 check(packs_left>=0), image text default '', active boolean not null default true
);
create table public.baseline_shop_orders (
 id bigint generated always as identity primary key,
 product_id bigint references public.baseline_products(id), product_name text not null,
 price numeric(10,2) not null check(price>=0), quantity integer not null check(quantity>0),
 customer_name text not null, payment_method text not null,
 delivered boolean not null default false, user_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index baseline_orders_product_idx on public.baseline_shop_orders(product_id);
create index baseline_orders_user_idx on public.baseline_shop_orders(user_id);
create table public.baseline_trip_events (
 id bigint generated always as identity primary key,
 name text not null check(length(name) between 1 and 200), video text,
 created_at timestamptz not null default now()
);
create table public.baseline_trip_votes (
 id bigint generated always as identity primary key,
 event_id bigint not null references public.baseline_trip_events(id) on delete cascade,
 name text not null check(length(name) between 1 and 150), vote text not null check(vote in ('yes','no')),
 created_at timestamptz not null default now()
);
create unique index baseline_vote_unique_name on public.baseline_trip_votes(event_id,lower(trim(name)));
create table public.baseline_signups (
 id bigint generated always as identity primary key,
 name text not null check(length(name) between 1 and 150),
 email text not null check(length(email) between 3 and 254),
 phone text not null check(length(phone) between 5 and 40), created_at timestamptz not null default now()
);

-- Every browser-accessible table has RLS; private contacts, enquiries and orders are never public reads.
do $$
declare t text;
begin
 for t in select tablename from pg_tables where schemaname='public' and tablename like 'baseline\_%' escape '\' loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('create policy "2027 administrator" on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',t);
 end loop;
 foreach t in array array['events','rsvps','tee_times','players','scores','products','trip_events','trip_votes'] loop
  execute format('grant select on public.%I to anon','baseline_'||t);
  execute format('create policy "Public 2027 content" on public.%I for select to anon,authenticated using (true)','baseline_'||t);
 end loop;
 foreach t in array array['rsvps','trip_votes','signups','rsvp_contacts'] loop
  execute format('grant insert on public.%I to anon','baseline_'||t);
  execute format('create policy "Public 2027 submissions" on public.%I for insert to anon,authenticated with check (true)','baseline_'||t);
 end loop;
 for t in select sequencename from pg_sequences where schemaname='public' and sequencename like 'baseline\_%' escape '\' loop
  execute format('grant usage on sequence public.%I to anon,authenticated',t);
 end loop;
end $$;
-- Left joins return no contact row unless the reader is an administrator.
grant select on public.baseline_rsvp_contacts to anon;
create policy "Own reservations" on public.baseline_shop_orders for select to authenticated using ((select auth.uid())=user_id);

create function public.baseline_submit_rsvp(payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare ev public.baseline_events; rid bigint; waiting boolean; will_attend boolean;
begin
 perform pg_advisory_xact_lock(9272027, (payload->>'event_id')::integer);
 select * into ev from public.baseline_events where id=(payload->>'event_id')::bigint;
 if ev.id is null or ev.cancelled then raise exception 'This event is unavailable'; end if;
 if length(trim(coalesce(payload->>'name',''))) not between 1 and 150 or length(trim(coalesce(payload->>'phone',''))) not between 5 and 40 then raise exception 'Enter your name and phone number'; end if;
 will_attend:=coalesce((payload->>'attending')::boolean,false);
 waiting:=will_attend and ev.max_players is not null and (select count(*) from public.baseline_rsvps r where r.event_id=ev.id and r.attending and not r.reserve)>=ev.max_players;
 insert into public.baseline_rsvps(event_id,name,attending,reserve,buggy,flexibility,preferred_time)
 values(ev.id,trim(payload->>'name'),will_attend and not waiting,waiting,coalesce((payload->>'buggy')::boolean,false),payload->>'flexibility',payload->>'preferred_time') returning id into rid;
 insert into public.baseline_rsvp_contacts(rsvp_id,phone,whatsapp_opt_in)
 values(rid,trim(payload->>'phone'),coalesce((payload->>'whatsapp_opt_in')::boolean,false));
 return jsonb_build_object('id',rid,'reserve',waiting);
exception when unique_violation then raise exception 'There is already an RSVP under this name. Contact the organiser to change it.';
end $$;
revoke all on function public.baseline_submit_rsvp(jsonb) from public;
grant execute on function public.baseline_submit_rsvp(jsonb) to anon,authenticated;

create function public.baseline_reset_scores() returns void language plpgsql security invoker set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Administrator access required'; end if;
 delete from public.baseline_scores;
end $$;
revoke all on function public.baseline_reset_scores() from public,anon;
grant execute on function public.baseline_reset_scores() to authenticated;

-- Stock and order writes form one transaction. The privileged implementation lives outside exposed schemas.
create function baseline_private.reserve_basket(items jsonb, customer text, payment text)
returns void language plpgsql security definer set search_path='' as $$
declare item record; p public.baseline_products; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Sign in with your 2027 account to reserve items'; end if;
 if length(trim(customer)) not between 1 and 150 or payment not in ('Bank Transfer','Cash at Event') then raise exception 'Enter your name and payment preference'; end if;
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 50 then raise exception 'Invalid basket'; end if;
 for item in select (value->>'id')::bigint as id,sum((value->>'qty')::integer)::integer as qty from jsonb_array_elements(items) group by 1 order by 1 loop
  if item.qty is null or item.qty not between 1 and 100 then raise exception 'Invalid quantity'; end if;
  select * into p from public.baseline_products where id=item.id and active for update;
  if p.id is null or p.packs_left<item.qty then raise exception 'An item is unavailable or out of stock'; end if;
  update public.baseline_products set packs_left=packs_left-item.qty where id=p.id;
  insert into public.baseline_shop_orders(product_id,product_name,price,quantity,customer_name,payment_method,user_id)
  values(p.id,p.name,p.price,item.qty,trim(customer),payment,uid);
 end loop;
end $$;
revoke all on function baseline_private.reserve_basket(jsonb,text,text) from public,anon;
grant execute on function baseline_private.reserve_basket(jsonb,text,text) to authenticated;
create function public.baseline_reserve_basket(items jsonb, customer text, payment text)
returns void language sql security invoker set search_path='' as $$ select baseline_private.reserve_basket(items,customer,payment); $$;
revoke all on function public.baseline_reserve_basket(jsonb,text,text) from public,anon;
grant execute on function public.baseline_reserve_basket(jsonb,text,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('baseline-gallery-images','baseline-gallery-images',true,15728640,array['image/jpeg','image/png','image/webp','image/heic','image/heif']),
 ('baseline-trip-videos','baseline-trip-videos',true,52428800,array['video/mp4','video/webm','video/quicktime']);
create policy "Read baseline media" on storage.objects for select to anon,authenticated using(bucket_id in ('baseline-gallery-images','baseline-trip-videos'));
create policy "Upload baseline gallery" on storage.objects for insert to authenticated with check(bucket_id='baseline-gallery-images' and (select auth.uid()) is not null and owner_id=(select auth.uid())::text);
create policy "Administer baseline media" on storage.objects for all to authenticated using(bucket_id in ('baseline-gallery-images','baseline-trip-videos') and (select public.is_admin())) with check(bucket_id in ('baseline-gallery-images','baseline-trip-videos') and (select public.is_admin()));
