-- Reusable course layouts for the fresh 2027 site only. No legacy maps are changed.
create table baseline_private.course_layouts (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 200),
 tee_name text not null check(length(trim(tee_name)) between 1 and 80),
 holes jsonb not null check(jsonb_typeof(holes)='array' and jsonb_array_length(holes)=18),
 revision integer not null default 0 check(revision>=0),
 source_tee_id uuid unique references public.course_scorecard_tees(id),
 created_by uuid not null references public.profiles(id),
 updated_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table baseline_private.course_layouts enable row level security;
revoke all on baseline_private.course_layouts from public,anon,authenticated;
alter table public.baseline_events add column course_layout_id uuid references baseline_private.course_layouts(id);
create index baseline_events_course_layout_idx on public.baseline_events(course_layout_id) where course_layout_id is not null;
alter table public.baseline_events add constraint baseline_social_no_hole_layout check(event_type<>'social' or course_layout_id is null);

create function baseline_private.normalise_course_holes(input jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare hole jsonb; point jsonb; clean jsonb; output jsonb:='[]'; seen integer[]:='{}'; indexes integer[]:='{}'; num integer; field text; value numeric;
begin
 if input is null or jsonb_typeof(input)<>'array' or jsonb_array_length(input)>18 then raise exception 'Supply up to 18 holes'; end if;
 for hole in select * from jsonb_array_elements(input) loop
  if jsonb_typeof(hole)<>'object' or jsonb_typeof(hole->'number') is distinct from 'number' then raise exception 'Every hole needs a number from 1 to 18'; end if;
  value:=(hole->>'number')::numeric;
  if value<>trunc(value) or value<1 or value>18 then raise exception 'Hole number must be from 1 to 18'; end if;
  num:=value::integer;
  if num=any(seen) then raise exception 'Each hole number must be unique'; end if;
  seen:=array_append(seen,num);
  clean:=jsonb_build_object('number',num);
  foreach field in array array['par','stroke_index','yards'] loop
   if hole->field is null or hole->field='null'::jsonb then clean:=clean||jsonb_build_object(field,null); continue; end if;
   if jsonb_typeof(hole->field)<>'number' then raise exception 'Hole %: % must be a whole number',num,field; end if;
   value:=(hole->>field)::numeric;
   if value<>trunc(value) or (field='par' and (value<3 or value>6)) or (field='stroke_index' and (value<1 or value>18)) or (field='yards' and (value<1 or value>1200)) then raise exception 'Hole %: invalid %',num,field; end if;
   if field='stroke_index' then
    if value::integer=any(indexes) then raise exception 'Stroke indexes must be unique across the course'; end if;
    indexes:=array_append(indexes,value::integer);
   end if;
   clean:=clean||jsonb_build_object(field,value::integer);
  end loop;
  foreach field in array array['tee','green','front','back','dogleg'] loop
   point:=hole->field;
   if point is null or point='null'::jsonb then clean:=clean||jsonb_build_object(field,null); continue; end if;
   if jsonb_typeof(point)<>'object' or jsonb_typeof(point->'lat') is distinct from 'number' or jsonb_typeof(point->'lng') is distinct from 'number' then raise exception 'Hole %: % needs latitude and longitude',num,field; end if;
   if (point->>'lat')::numeric not between -90 and 90 or (point->>'lng')::numeric not between -180 and 180 then raise exception 'Hole %: % coordinates are outside the map',num,field; end if;
   clean:=clean||jsonb_build_object(field,jsonb_build_object('lat',(point->>'lat')::numeric,'lng',(point->>'lng')::numeric));
  end loop;
  if hole->'reviewed' is not null and hole->'reviewed'<>'null'::jsonb and jsonb_typeof(hole->'reviewed')<>'boolean' then raise exception 'Hole %: reviewed must be true or false',num; end if;
  clean:=clean||jsonb_build_object('reviewed',coalesce((hole->>'reviewed')::boolean,false));
  if (clean->>'reviewed')::boolean and (clean->'tee'='null'::jsonb or clean->'green'='null'::jsonb or clean->'tee'=clean->'green') then raise exception 'Hole %: mark separate tee and green positions before reviewing',num; end if;
  output:=output||jsonb_build_array(clean);
 end loop;
 return (select jsonb_agg(coalesce(h,jsonb_build_object('number',n,'par',null,'stroke_index',null,'yards',null,'tee',null,'green',null,'front',null,'back',null,'dogleg',null,'reviewed',false)) order by n)
  from generate_series(1,18) n left join jsonb_array_elements(output) h on (h->>'number')::integer=n);
end $$;
revoke all on function baseline_private.normalise_course_holes(jsonb) from public,anon,authenticated;

create function baseline_private.course_layout(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); admin boolean; item baseline_private.course_layouts; ev public.baseline_events; new_holes jsonb; result jsonb; legacy record; before_row jsonb; desired uuid;
begin
 if uid is null or not baseline_private.active_member() then raise exception 'Member sign-in required'; end if;
 admin:=public.is_admin();
 if action='event' then
  select * into ev from public.baseline_events where id=(payload->>'event_id')::bigint;
  if ev.id is null or ev.cancelled then raise exception 'Event unavailable'; end if;
  if ev.event_type='social' or ev.course_layout_id is null then return jsonb_build_object('event_id',ev.id,'layout',null); end if;
  select * into item from baseline_private.course_layouts where id=ev.course_layout_id;
  new_holes:=item.holes;
  if not admin then
   select jsonb_agg(case when (h->>'reviewed')::boolean then h else h||jsonb_build_object('tee',null,'green',null,'front',null,'back',null,'dogleg',null) end order by (h->>'number')::integer) into new_holes from jsonb_array_elements(new_holes) h;
  end if;
  return jsonb_build_object('event_id',ev.id,'layout',jsonb_build_object('id',item.id,'name',item.name,'tee_name',item.tee_name,'holes',new_holes,'revision',item.revision,'updated_at',item.updated_at,'ready_count',(select count(*) from jsonb_array_elements(item.holes) h where (h->>'reviewed')::boolean)));
 end if;
 if not admin then raise exception 'Organiser access required'; end if;
 if action='list' then
  return jsonb_build_object('layouts',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('ready_count',(select count(*) from jsonb_array_elements(l.holes) h where (h->>'reviewed')::boolean)) order by lower(l.name),lower(l.tee_name)) from baseline_private.course_layouts l),'[]'::jsonb),
   'legacy',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',c.course_name||case when c.course_layout='Main course' then '' else ' · '||c.course_layout end,'tee_name',t.tee_name,'hole_count',(select count(*) from public.course_scorecard_holes h where h.tee_id=t.id),'mapped_count',(select count(*) from public.course_hole_maps m where m.course_scorecard_id=c.id),'imported_layout_id',(select l.id from baseline_private.course_layouts l where l.source_tee_id=t.id)) order by lower(c.course_name),lower(t.tee_name)) from public.course_scorecards c join public.course_scorecard_tees t on t.scorecard_id=c.id),'[]'::jsonb));
 elsif action='get' then
  select * into item from baseline_private.course_layouts where id=(payload->>'id')::uuid;
  if item.id is null then raise exception 'Course layout not found'; end if;
 elsif action='save' then
  if length(trim(coalesce(payload->>'name','')))=0 or length(payload->>'name')>200 then raise exception 'Enter the course name (up to 200 characters)'; end if;
  if length(trim(coalesce(payload->>'tee_name','')))=0 or length(payload->>'tee_name')>80 then raise exception 'Enter the tee name (up to 80 characters)'; end if;
  new_holes:=baseline_private.normalise_course_holes(payload->'holes');
  if nullif(payload->>'id','') is null then
   insert into baseline_private.course_layouts(name,tee_name,holes,created_by,updated_by) values(trim(payload->>'name'),trim(payload->>'tee_name'),new_holes,uid,uid) returning * into item;
  else
   select * into item from baseline_private.course_layouts where id=(payload->>'id')::uuid for update;
   if item.id is null then raise exception 'Course layout not found'; end if;
   if item.revision is distinct from (payload->>'revision')::integer then raise exception 'Course layout changed. Refresh before saving'; end if;
   before_row:=to_jsonb(item);
   update baseline_private.course_layouts set name=trim(payload->>'name'),tee_name=trim(payload->>'tee_name'),holes=new_holes,revision=revision+1,updated_at=now(),updated_by=uid where id=item.id returning * into item;
  end if;
 elsif action='import' then
  select * into item from baseline_private.course_layouts where source_tee_id=(payload->>'legacy_id')::uuid;
  if item.id is null then
   select t.id,t.tee_name,c.id scorecard_id,c.course_name||case when c.course_layout='Main course' then '' else ' · '||c.course_layout end course_name into legacy from public.course_scorecard_tees t join public.course_scorecards c on c.id=t.scorecard_id where t.id=(payload->>'legacy_id')::uuid;
   if legacy.id is null then raise exception 'Previous course layout not found'; end if;
   select jsonb_agg(jsonb_build_object('number',n,'par',h.par,'stroke_index',h.stroke_index,'yards',h.yards,
    'tee',case when m.tee_lat is null then null else jsonb_build_object('lat',m.tee_lat,'lng',m.tee_lng) end,
    'green',case when m.green_lat is null then null else jsonb_build_object('lat',m.green_lat,'lng',m.green_lng) end,
    'dogleg',(select jsonb_build_object('lat',p->'lat','lng',p->'lng') from jsonb_array_elements(m.route_points) p where p->>'type'='corner' limit 1),'front',null,'back',null,'reviewed',false) order by n)
    into new_holes from generate_series(1,18) n left join public.course_scorecard_holes h on h.tee_id=legacy.id and h.hole_number=n left join public.course_hole_maps m on m.course_scorecard_id=legacy.scorecard_id and m.hole_number=n;
   new_holes:=baseline_private.normalise_course_holes(new_holes);
   insert into baseline_private.course_layouts(name,tee_name,holes,source_tee_id,created_by,updated_by) values(legacy.course_name,legacy.tee_name,new_holes,legacy.id,uid,uid)
    on conflict(source_tee_id) do nothing returning * into item;
   if item.id is null then select * into item from baseline_private.course_layouts where source_tee_id=legacy.id; end if;
  end if;
 elsif action='attach' then
  select * into ev from public.baseline_events where id=(payload->>'event_id')::bigint for update;
  if ev.id is null or ev.cancelled then raise exception 'Event unavailable'; end if;
  if ev.course_layout_id is distinct from (payload->>'expected_layout_id')::uuid then raise exception 'Event course changed. Refresh before saving'; end if;
  desired:=(payload->>'layout_id')::uuid;
  if desired is not null and ev.event_type='social' then raise exception 'Social events do not need a hole layout'; end if;
  if desired is not null and not exists(select 1 from baseline_private.course_layouts where id=desired) then raise exception 'Course layout not found'; end if;
  update public.baseline_events set course_layout_id=desired where id=ev.id;
  insert into baseline_private.operation_audit(actor,action,details) values(uid,'course_layout_attach',jsonb_build_object('event_id',ev.id,'before',ev.course_layout_id,'after',desired));
  return jsonb_build_object('event_id',ev.id,'layout_id',desired);
 else raise exception 'Unknown course layout action'; end if;
 if action in ('save','import') then
  insert into baseline_private.operation_audit(actor,action,details) values(uid,'course_layout_'||action,jsonb_build_object('layout_id',item.id,'before',before_row,'after',to_jsonb(item)));
 end if;
 return to_jsonb(item)||jsonb_build_object('ready_count',(select count(*) from jsonb_array_elements(item.holes) h where (h->>'reviewed')::boolean));
end $$;
create function public.baseline_course_layout(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select baseline_private.course_layout(action,payload);$$;
revoke all on function baseline_private.course_layout(text,jsonb),public.baseline_course_layout(text,jsonb) from public,anon,authenticated;
grant execute on function baseline_private.course_layout(text,jsonb),public.baseline_course_layout(text,jsonb) to authenticated;
