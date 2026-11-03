-- Synthetic fixtures only. Every write and role change rolls back.
begin;
create temp table event_edit_qa(host uuid,guest uuid,m2 uuid,m3 uuid,waiting uuid,event_id bigint,before_groups jsonb);
grant select,update on event_edit_qa to authenticated;
insert into event_edit_qa select (select id from public.profiles where is_admin limit 1),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,null;
insert into public.baseline_members(id,name)
select guest,'QA Event Guest' from event_edit_qa union all select m2,'QA Event Two' from event_edit_qa
union all select m3,'QA Event Three' from event_edit_qa union all select waiting,'QA Event Waiting' from event_edit_qa;
with ev as(insert into public.baseline_events(name,date,event_type,first_time,tee_interval,max_players,member_price,guest_price)
 values('QA editable event',current_date+50,'pairs','09:00',8,4,40,50) returning id)
update event_edit_qa set event_id=(select id from ev);
select set_config('request.jwt.claim.sub',(select host::text from event_edit_qa),true);
set local role authenticated;
select public.baseline_submit_rsvp(jsonb_build_object('event_id',event_id,'attending',true)) from event_edit_qa;
select public.baseline_submit_rsvp(jsonb_build_object('event_id',event_id,'member_id',guest,'attending',true)) from event_edit_qa;
select public.baseline_submit_rsvp(jsonb_build_object('event_id',event_id,'member_id',m2,'attending',true)) from event_edit_qa;
select public.baseline_submit_rsvp(jsonb_build_object('event_id',event_id,'member_id',m3,'attending',true)) from event_edit_qa;
reset role;
update public.baseline_rsvps set guest_host_id=(select host from event_edit_qa) where member_id=(select guest from event_edit_qa);
set local role authenticated;
select public.baseline_save_tee_times(event_id,jsonb_build_array(
 jsonb_build_object('time','09:00','players',jsonb_build_array(host,guest)),
 jsonb_build_object('time','09:11','players',jsonb_build_array(m2)),
 jsonb_build_object('time','09:27','players',jsonb_build_array(m3)))) from event_edit_qa;
update event_edit_qa set before_groups=(select jsonb_agg(jsonb_build_object('id',id,'group_number',group_number,'players',players) order by group_number) from public.baseline_tee_times where event_id=event_edit_qa.event_id);
update public.baseline_events set name='QA Edited after publication',date=current_date+55,description='New meeting information',address='New venue address',refreshment_time='08:15',guest_price=55,member_price=45 where id=(select event_id from event_edit_qa);
do $$declare q event_edit_qa;begin
 select * into q from event_edit_qa;
 if (select tee_times_dirty from public.baseline_events where id=q.event_id) then raise exception 'Metadata edit hid a valid tee sheet'; end if;
 if (select count(*) from public.baseline_rsvps where event_id=q.event_id and attending)<>4 then raise exception 'Event edit lost RSVPs'; end if;
end $$;
update public.baseline_events set first_time='10:15' where id=(select event_id from event_edit_qa);
do $$declare q event_edit_qa;begin
 select * into q from event_edit_qa;
 if (select array_agg(tee_time order by group_number) from public.baseline_tee_times where event_id=q.event_id)<>array['10:15','10:26','10:42'] then raise exception 'Start change did not preserve custom intervals'; end if;
 if (select jsonb_agg(jsonb_build_object('id',id,'group_number',group_number,'players',players) order by group_number) from public.baseline_tee_times where event_id=q.event_id)<>q.before_groups then raise exception 'Time edit changed a group or guest pairing'; end if;
 if (select tee_times_dirty or tee_published_at is null from public.baseline_events where id=q.event_id) then raise exception 'Time edit unpublished a valid sheet'; end if;
end $$;
reset role;
do $$begin
 if not exists(select 1 from baseline_private.tee_changes where event_id=(select event_id from event_edit_qa) and user_id=(select host from event_edit_qa) and old_time='09:00' and new_time='10:15') then raise exception 'Changed member time has no notice'; end if;
end $$;
set local role authenticated;
update public.baseline_events set tee_interval=12 where id=(select event_id from event_edit_qa);
do $$declare q event_edit_qa;before jsonb;begin
 select * into q from event_edit_qa;
 if (select array_agg(tee_time order by group_number) from public.baseline_tee_times where event_id=q.event_id)<>array['10:15','10:27','10:39'] then raise exception 'Gap change did not retime groups'; end if;
 select to_jsonb(e) into before from public.baseline_events e where id=q.event_id;
 begin update public.baseline_events set first_time='23:50',name='Must roll back' where id=q.event_id; raise exception 'Overnight tee times accepted';
 exception when raise_exception then if sqlerrm not like 'These tee times would run into another day%' then raise;end if;end;
 if (select to_jsonb(e) from public.baseline_events e where id=q.event_id)<>before then raise exception 'Invalid edit partially saved the event'; end if;
 if (select array_agg(tee_time order by group_number) from public.baseline_tee_times where event_id=q.event_id)<>array['10:15','10:27','10:39'] then raise exception 'Invalid edit partially retimed groups'; end if;
 begin update public.baseline_events set first_time=null where id=q.event_id;raise exception 'Null start accepted';
 exception when raise_exception then if sqlerrm<>'Enter a valid first tee time while tee groups exist' then raise;end if;end;
end $$;
-- Re-publication keeps Event details in sync, without the event trigger moving it again.
select public.baseline_save_tee_times(event_id,jsonb_build_array(
 jsonb_build_object('time','11:00','players',jsonb_build_array(host,guest)),
 jsonb_build_object('time','11:15','players',jsonb_build_array(m2)),
 jsonb_build_object('time','11:30','players',jsonb_build_array(m3)))) from event_edit_qa;
do $$declare q event_edit_qa;begin
 select * into q from event_edit_qa;
 if not exists(select 1 from public.baseline_events where id=q.event_id and first_time='11:00' and tee_interval=15 and not tee_times_dirty) then raise exception 'Publishing did not sync event settings'; end if;
 if (select array_agg(tee_time order by group_number) from public.baseline_tee_times where event_id=q.event_id)<>array['11:00','11:15','11:30'] then raise exception 'Publishing double shifted times';end if;
end $$;
update public.baseline_events set max_players=5 where id=(select event_id from event_edit_qa);
do $$begin if (select tee_times_dirty from public.baseline_events where id=(select event_id from event_edit_qa)) then raise exception 'Capacity-only edit hid valid tee sheet';end if;end $$;
update public.baseline_events set max_players=4 where id=(select event_id from event_edit_qa);
select public.baseline_submit_rsvp(jsonb_build_object('event_id',event_id,'member_id',waiting,'attending',true)) from event_edit_qa;
update public.baseline_events set max_players=5 where id=(select event_id from event_edit_qa);
update public.baseline_events set first_time='12:00' where id=(select event_id from event_edit_qa);
do $$declare q event_edit_qa;begin
 select * into q from event_edit_qa;
 if not (select tee_times_dirty from public.baseline_events where id=q.event_id) then raise exception 'Timing edit cleared pending player changes';end if;
 if not exists(select 1 from public.baseline_rsvps where event_id=q.event_id and member_id=q.waiting and attending and not reserve) then raise exception 'Capacity edit failed to promote waiting player';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select m2::text from event_edit_qa),true);
set local role authenticated;
update public.baseline_events set name='Unauthorised change' where id=(select event_id from event_edit_qa);
reset role;
do $$begin
 if (select name from public.baseline_events where id=(select event_id from event_edit_qa))='Unauthorised change' then raise exception 'Non-admin edited event';end if;
end $$;
rollback;
select 'PASS: published event edits, atomic schedule shifts, unchanged groups/guests, notices, republish sync, capacity and admin-only writes' result;
