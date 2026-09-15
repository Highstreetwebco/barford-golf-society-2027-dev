begin;
alter table public.events add column if not exists course_member_price numeric(10,2) check (course_member_price >= 0);
alter table public.rsvps add column if not exists is_course_member boolean not null default false;

create or replace function public.check_course_member_rate()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 if tg_op='UPDATE' and new.is_course_member=old.is_course_member and new.event_id=old.event_id and new.member_id is not distinct from old.member_id then return new; end if;
 if new.is_course_member then
  if new.member_id is null then raise exception 'The course-member price is only available to Barford members'; end if;
  if not exists(select 1 from public.events where id=new.event_id and course_member_price is not null) then raise exception 'No course-member price is available for this event'; end if;
 end if;
 if tg_op='UPDATE' and not public.is_admin() then
  if old.payment_status in ('paid','waived','refunded') then raise exception 'Ask the committee to change the price category after payment has been settled'; end if;
  if public.get_event_rsvp_lock_status(new.event_id) then raise exception 'Price choices are locked with the tee groups. Please contact the committee'; end if;
 end if;
 return new;
end $$;
revoke all on function public.check_course_member_rate() from public,anon,authenticated;
create trigger check_course_member_rate before insert or update of is_course_member,event_id,member_id on public.rsvps for each row execute function public.check_course_member_rate();

create or replace function public.set_my_priced_event_rsvp(p_event_id uuid,p_status text,p_buggy_requested boolean default false,p_preferred_tee_time text default null,p_is_course_member boolean default false)
returns text language plpgsql security invoker set search_path = '' as $$
declare result text;
begin
 if auth.uid() is null then raise exception 'Please sign in'; end if;
 result := public.set_my_event_rsvp(p_event_id,p_status,p_buggy_requested,p_preferred_tee_time);
 update public.rsvps set is_course_member=coalesce(p_is_course_member,false) where event_id=p_event_id and member_id=auth.uid();
 if not found then raise exception 'Your booking could not be updated'; end if;
 return result;
end $$;
revoke all on function public.set_my_priced_event_rsvp(uuid,text,boolean,text,boolean) from public,anon;
grant execute on function public.set_my_priced_event_rsvp(uuid,text,boolean,text,boolean) to authenticated;
commit;
