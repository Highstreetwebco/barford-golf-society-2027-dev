-- Start the dashboard's 48-hour window at publication, not a later event edit.
-- Older completed events have no reliable publication timestamp and stay null.
-- On rollout only, today’s already completed round gets a window starting now.
begin;
alter table public.events add column if not exists results_published_at timestamptz;
create or replace function public.stamp_event_results_published()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.status='completed' then
    if tg_op='INSERT' then new.results_published_at=statement_timestamp();
    elsif old.status is distinct from 'completed' then new.results_published_at=statement_timestamp();
    else new.results_published_at=old.results_published_at;
    end if;
  else new.results_published_at=null;
  end if;
  return new;
end $$;
revoke all on function public.stamp_event_results_published() from public,anon,authenticated;
drop trigger if exists stamp_event_results_published on public.events;
update public.events set results_published_at=statement_timestamp()
where status='completed' and results_published_at is null
  and event_date=(now() at time zone 'Europe/London')::date;
create trigger stamp_event_results_published before insert or update on public.events
for each row execute function public.stamp_event_results_published();
notify pgrst,'reload schema';
commit;
