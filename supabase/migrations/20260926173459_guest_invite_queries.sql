-- Existing bookings show their agreed charge if the advertised event rate changes.
create or replace function baseline_private.guest_invitations(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();l baseline_private.guest_links;ev public.baseline_events;g baseline_private.guest_requests;h numeric;result jsonb;
begin
 if action='view' then
 select * into l from baseline_private.guest_links where token=(payload->>'token')::uuid;
 if l.token is null or l.revoked then return jsonb_build_object('status','unavailable');end if;
 select * into ev from public.baseline_events where id=l.event_id;
 if ev.cancelled or ev.date<(now() at time zone 'Europe/London')::date or (ev.rsvp_deadline is not null and ev.rsvp_deadline<(now() at time zone 'Europe/London')::date) or not exists(select 1 from public.baseline_member_accounts where user_id=l.host_id and not disabled) then return jsonb_build_object('status','closed');end if;
 if l.claimed_by is not null and l.claimed_by is distinct from uid then return jsonb_build_object('status','used');end if;
 return jsonb_build_object('status',case when l.claimed_by=uid then 'joined' else 'open' end,'event_id',ev.id,'event_name',ev.name,'date',ev.date,'first_time',ev.first_time,'location',ev.location,'event_type',ev.event_type,'host_name',(select full_name from public.profiles where id=l.host_id),'guest_price',ev.guest_price,'payment_due',ev.payment_due,'cancellation_terms',ev.cancellation_terms,'rsvp_deadline',ev.rsvp_deadline,'waiting',ev.max_players is not null and (select count(*) from public.baseline_rsvps where event_id=ev.id and attending and not reserve)>=ev.max_players);
 end if;
 if not baseline_private.active_member() then raise exception 'Sign in with your active account';end if;
 if action='create' then
 if coalesce((select category from baseline_private.member_types where user_id=uid),'member')='guest' and not public.is_admin() then raise exception 'A society member must invite guests';end if;
 select * into ev from public.baseline_events where id=(payload->>'event_id')::bigint;
 if ev.id is null or ev.cancelled or ev.date<(now() at time zone 'Europe/London')::date or (ev.rsvp_deadline is not null and ev.rsvp_deadline<(now() at time zone 'Europe/London')::date) then raise exception 'Bookings for this round are closed';end if;
 if ev.guest_price is null then raise exception 'Ask an organiser to add the guest price to this event first';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,2028));
 if (select count(*) from baseline_private.guest_links where host_id=uid and created_at>now()-interval '1 day')>=10 then raise exception 'You have created ten invitations today. Reuse an unused invite or contact an organiser';end if;
 insert into baseline_private.guest_links(host_id,event_id) values(uid,ev.id) returning * into l;
 return jsonb_build_object('token',l.token,'event_id',ev.id,'host_name',(select full_name from public.profiles where id=uid));
 elsif action='join' then return baseline_private.accept_guest((payload->>'token')::uuid,uid,payload,false);
 elsif action='mine' then
 return jsonb_build_object('category',coalesce((select category from baseline_private.member_types where user_id=uid),'member'),'links',coalesce((select jsonb_agg(jsonb_build_object('token',lk.token,'claimed',lk.claimed_by is not null,'revoked',lk.revoked,'guest_name',p.full_name,'event_id',lk.event_id) order by lk.created_at desc) from baseline_private.guest_links lk left join public.profiles p on p.id=lk.claimed_by where lk.host_id=uid and lk.event_id=(payload->>'event_id')::bigint),'[]'::jsonb),'bookings',coalesce((select jsonb_agg(jsonb_build_object('event_id',r.event_id,'host_name',p.full_name,'status',gr.status,'requested_handicap',gr.requested_handicap,'guest_price',coalesce((select c.amount from baseline_private.charges c where c.user_id=r.user_id and c.event_id=r.event_id),er.guest_price),'reserve',r.reserve,'attending',r.attending,'event_name',er.name,'date',er.date) order by er.date,er.id) from public.baseline_rsvps r join public.baseline_events er on er.id=r.event_id join public.profiles p on p.id=r.guest_host_id left join baseline_private.guest_requests gr on gr.event_id=r.event_id and gr.user_id=r.user_id where r.user_id=uid and er.date>=(now() at time zone 'Europe/London')::date and not er.cancelled),'[]'::jsonb));
 elsif action='revoke' then
 update baseline_private.guest_links set revoked=true where token=(payload->>'token')::uuid and (host_id=uid or public.is_admin()) and claimed_by is null;
 if not found then raise exception 'Only an unused invitation can be cancelled';end if;return '{}'::jsonb;
 elsif action='review' then
 if not public.is_admin() then raise exception 'Organiser access required';end if;
 select * into g from baseline_private.guest_requests where id=(payload->>'id')::uuid and link_token is not null for update;
 if g.id is null or g.status<>'pending' then raise exception 'This handicap request is already reviewed';end if;
 h:=(payload->>'handicap')::numeric;
 if h is null or h::text in ('NaN','Infinity','-Infinity') or h<0 or h>36 or round(h,1)<>h then raise exception 'Approve a society starting handicap from 0 to 36';end if;
 update public.profiles set handicap=h where id=g.user_id and handicap is null;
 update baseline_private.guest_requests set status='approved',approved_handicap=(select handicap from public.profiles where id=g.user_id) where id=g.id;
 insert into baseline_private.operation_audit(actor,action,details) values(uid,'approve_guest_handicap',jsonb_build_object('id',g.id,'handicap',h));return '{}'::jsonb;
 else raise exception 'Unknown invitation action';end if;
end $$;
