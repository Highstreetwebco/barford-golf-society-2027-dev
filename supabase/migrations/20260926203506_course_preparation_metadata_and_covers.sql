-- 2027 only. Course lookup enriches reusable layouts; it never rewrites mapped holes.
alter table baseline_private.course_layouts
 add column place_id text check(place_id is null or length(place_id) between 1 and 250),
 add column center jsonb,
 add column address text check(address is null or length(address)<=500),
 add column source jsonb check(source is null or (jsonb_typeof(source)='object' and octet_length(source::text)<=24000));
create index baseline_course_place_idx on baseline_private.course_layouts(place_id) where place_id is not null;

create function baseline_private.course_name_key(input text) returns text language sql immutable security invoker set search_path='' as $$
 select trim(regexp_replace(regexp_replace(lower(coalesce(input,'')),'\m(the|at|and|golf|club|course|country|resort|limited|ltd)\M',' ','g'),'[^a-z0-9]+',' ','g'));
$$;
create function baseline_private.course_match(candidate jsonb,wanted jsonb) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare a text:=baseline_private.course_name_key(candidate->>'name'); b text:=baseline_private.course_name_key(wanted->>'name'); lat numeric; lng numeric; d double precision;
begin
 if nullif(candidate->>'place_id','') is not null then return candidate->>'place_id'=wanted->>'place_id'; end if;
 if length(a)<4 or a<>b or candidate->'center' is null or candidate->'center'='null'::jsonb then return false;end if;
 if jsonb_typeof(wanted->'latitude') is distinct from 'number' or jsonb_typeof(wanted->'longitude') is distinct from 'number' then return false;end if;
 lat:=(wanted->>'latitude')::numeric;lng:=(wanted->>'longitude')::numeric;
 if lat not between -90 and 90 or lng not between -180 and 180 then return false;end if;
 d:=power(sin(radians(((candidate#>>'{center,lat}')::double precision-lat::double precision)/2)),2)+cos(radians(lat::double precision))*cos(radians((candidate#>>'{center,lat}')::double precision))*power(sin(radians(((candidate#>>'{center,lng}')::double precision-lng::double precision)/2)),2);
 return 6371000*2*asin(sqrt(least(1,greatest(0,d))))<=2500;
end $$;
revoke all on function baseline_private.course_name_key(text),baseline_private.course_match(jsonb,jsonb) from public,anon,authenticated;

alter function baseline_private.course_layout(text,jsonb) rename to course_layout_core;
revoke all on function baseline_private.course_layout_core(text,jsonb) from public,anon,authenticated;
create function baseline_private.course_layout(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; item baseline_private.course_layouts; center_value jsonb; source_value jsonb; metadata jsonb; wanted_place text;
begin
 if auth.uid() is null or not baseline_private.active_member() then raise exception 'Member sign-in required';end if;
 if action='event' then
  result:=baseline_private.course_layout_core(action,payload);
  if result->'layout'<>'null'::jsonb then
   select * into item from baseline_private.course_layouts where id=(result#>>'{layout,id}')::uuid;
   result:=jsonb_set(result,'{layout}',result->'layout'||jsonb_build_object('place_id',item.place_id,'center',item.center,'address',item.address,'source',item.source));
  end if;
  return result;
 end if;
 if not public.is_admin() then raise exception 'Organiser access required';end if;
 if action in ('save','import') then
  if payload ? 'place_id' and payload->'place_id'<>'null'::jsonb and (jsonb_typeof(payload->'place_id')<>'string' or length(trim(payload->>'place_id')) not between 1 and 250) then raise exception 'Invalid course place reference';end if;
  if payload ? 'address' and payload->'address'<>'null'::jsonb and (jsonb_typeof(payload->'address')<>'string' or length(payload->>'address')>500) then raise exception 'Course address is too long';end if;
  center_value:=payload->'center';
  if center_value is not null and center_value<>'null'::jsonb then
   if jsonb_typeof(center_value)<>'object' or jsonb_typeof(center_value->'lat') is distinct from 'number' or jsonb_typeof(center_value->'lng') is distinct from 'number' then raise exception 'Course centre needs latitude and longitude';end if;
   if (center_value->>'lat')::numeric not between -90 and 90 or (center_value->>'lng')::numeric not between -180 and 180 then raise exception 'Course centre is outside the map';end if;
   center_value:=jsonb_build_object('lat',(center_value->>'lat')::numeric,'lng',(center_value->>'lng')::numeric);
  end if;
  source_value:=payload->'source';
  if source_value is not null and source_value<>'null'::jsonb then
   if jsonb_typeof(source_value)<>'object' or octet_length(source_value::text)>24000 then raise exception 'Course source details are too large';end if;
   if source_value ? 'url' and (jsonb_typeof(source_value->'url')<>'string' or source_value->>'url' !~ '^https://[^[:space:]]+$') then raise exception 'Course source link must use HTTPS';end if;
  end if;
  result:=baseline_private.course_layout_core(action,payload);
  select * into item from baseline_private.course_layouts where id=(result->>'id')::uuid for update;
  if action='import' then
   -- Reusing a previously imported layout preserves its link, corrections and provenance.
   wanted_place:=coalesce(item.place_id,nullif(trim(payload->>'place_id'),''));
   center_value:=coalesce(item.center,nullif(center_value,'null'::jsonb),(select jsonb_build_object('lat',avg(m.tee_lat),'lng',avg(m.tee_lng)) from public.course_hole_maps m join public.course_scorecard_tees t on t.scorecard_id=m.course_scorecard_id where t.id=item.source_tee_id having count(*)>0));
   source_value:=coalesce(item.source,nullif(source_value,'null'::jsonb),jsonb_build_object('provider','legacy','attribution',case when exists(select 1 from public.course_hole_maps m join public.course_scorecard_tees t on t.scorecard_id=m.course_scorecard_id where t.id=item.source_tee_id and m.mapping_source='openstreetmap') then '© OpenStreetMap contributors · saved Barford course setup' else 'Saved Barford course setup' end,'url','https://www.openstreetmap.org/copyright','warnings',jsonb_build_array('Check the imported tee and green positions before publication.')));
  else
   wanted_place:=case when payload ? 'place_id' then nullif(trim(payload->>'place_id'),'') else item.place_id end;
   center_value:=case when payload ? 'center' then nullif(center_value,'null'::jsonb) else item.center end;
   source_value:=case when payload ? 'source' then nullif(source_value,'null'::jsonb) else item.source end;
  end if;
  metadata:=to_jsonb(item);
  update baseline_private.course_layouts set place_id=wanted_place,center=center_value,source=source_value,
   address=case when action='import' then coalesce(item.address,payload->>'address') when payload ? 'address' then payload->>'address' else item.address end,
   revision=revision+case when action='import' and (item.place_id is distinct from wanted_place or item.center is distinct from center_value or item.source is distinct from source_value or (item.address is null and payload->>'address' is not null)) then 1 else 0 end,
   updated_at=now(),updated_by=auth.uid()
   where id=item.id returning * into item;
  insert into baseline_private.operation_audit(actor,action,details) values(auth.uid(),'course_layout_metadata',jsonb_build_object('layout_id',item.id,'before',metadata,'after',to_jsonb(item)));
  return to_jsonb(item)||jsonb_build_object('ready_count',(select count(*) from jsonb_array_elements(item.holes) h where (h->>'reviewed')::boolean));
 elsif action in ('list','match') then
  result:=baseline_private.course_layout_core('list','{}');
  select coalesce(jsonb_agg(l||jsonb_build_object('center',coalesce(nullif(l->'center','null'::jsonb),(select jsonb_build_object('lat',avg((h#>>'{tee,lat}')::numeric),'lng',avg((h#>>'{tee,lng}')::numeric)) from jsonb_array_elements(l->'holes') h where h->'tee'<>'null'::jsonb having count(*)>0))) order by l->>'name',l->>'tee_name'),'[]'::jsonb) into metadata from jsonb_array_elements(result->'layouts') l;
  result:=jsonb_set(result,'{layouts}',metadata);
  select coalesce(jsonb_agg(l||jsonb_build_object('center',(select jsonb_build_object('lat',avg(m.tee_lat),'lng',avg(m.tee_lng)) from public.course_hole_maps m join public.course_scorecard_tees t on t.scorecard_id=m.course_scorecard_id where t.id=(l->>'id')::uuid having count(*)>0)) order by l->>'name',l->>'tee_name'),'[]'::jsonb) into metadata from jsonb_array_elements(result->'legacy') l;
  result:=jsonb_set(result,'{legacy}',metadata);
  if action='match' then
   select coalesce(jsonb_agg(l||jsonb_build_object('match_quality',case when l->>'place_id'=payload->>'place_id' then 'place' else 'nearby_name' end) order by case when lower(l->>'tee_name')=lower(payload->>'tee_name') then 0 else 1 end,l->>'name',l->>'tee_name'),'[]'::jsonb) into metadata from jsonb_array_elements(result->'layouts') l where baseline_private.course_match(l,payload);
   result:=jsonb_set(result,'{layouts}',metadata);
   select coalesce(jsonb_agg(l||jsonb_build_object('match_quality','nearby_name') order by l->>'name',l->>'tee_name'),'[]'::jsonb) into metadata from jsonb_array_elements(result->'legacy') l where baseline_private.course_match(l,payload);
   result:=jsonb_set(result,'{legacy}',metadata);
  end if;
  return result;
 else return baseline_private.course_layout_core(action,payload);end if;
end $$;
revoke all on function baseline_private.course_layout(text,jsonb) from public,anon,authenticated;
grant execute on function baseline_private.course_layout(text,jsonb) to authenticated;
-- Rebind the public invoker wrapper explicitly after renaming the implementation.
create or replace function public.baseline_course_layout(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select baseline_private.course_layout(action,payload);$$;
revoke all on function public.baseline_course_layout(text,jsonb) from public,anon,authenticated;
grant execute on function public.baseline_course_layout(text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('baseline-event-covers','baseline-event-covers',true,2097152,array['image/jpeg','image/png','image/webp']);
-- Public image delivery is built into this public bucket; object listing is admin-only.
create policy "Active admins list event covers" on storage.objects for select to authenticated
 using(bucket_id='baseline-event-covers' and (select baseline_private.active_member()) and (select public.is_admin()));
create policy "Active admins upload own event covers" on storage.objects for insert to authenticated
 with check(bucket_id='baseline-event-covers' and (select baseline_private.active_member()) and (select public.is_admin()) and (storage.foldername(name))[1]=(select auth.uid())::text and lower(storage.extension(name)) in ('jpg','jpeg','png','webp'));
create policy "Active admins delete own event covers" on storage.objects for delete to authenticated
 using(bucket_id='baseline-event-covers' and (select baseline_private.active_member()) and (select public.is_admin()) and (storage.foldername(name))[1]=(select auth.uid())::text and owner_id=(select auth.uid())::text);
-- No UPDATE policy: each uploaded cover gets a new immutable path.
