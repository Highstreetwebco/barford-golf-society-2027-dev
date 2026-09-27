-- A member sees only payment state for other players, plus their own charge.
create function baseline_private.event_payment_overview(event bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); own jsonb;
begin
 if not baseline_private.active_member() then raise exception 'Member sign-in required'; end if;
 if not exists(select 1 from public.baseline_events where id=event) then raise exception 'Event not found'; end if;
 select jsonb_build_object('id',c.id,'amount',c.amount,'received',c.received,'reported',c.reported)
 into own from baseline_private.charges c where c.event_id=event and c.user_id=uid;
 return jsonb_build_object('own_charge',own,'players',coalesce((
  select jsonb_agg(jsonb_build_object('user_id',r.user_id,'status',
    case when c.id is not null and c.received>=c.amount then 'paid'
         when coalesce(c.reported,false) then 'pending' else 'unpaid' end) order by lower(r.name))
  from public.baseline_rsvps r left join baseline_private.charges c
   on c.event_id=r.event_id and c.user_id=r.user_id
  where r.event_id=event and r.attending and not r.reserve
 ),'[]'::jsonb));
end $$;
create function public.baseline_event_payment_overview(event bigint)
returns jsonb language sql stable security invoker set search_path='' as $$
 select baseline_private.event_payment_overview(event);
$$;
revoke all on function baseline_private.event_payment_overview(bigint),public.baseline_event_payment_overview(bigint) from public,anon;
grant execute on function baseline_private.event_payment_overview(bigint),public.baseline_event_payment_overview(bigint) to authenticated;

create function baseline_private.set_transfer_confirmation(event bigint,paid boolean)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); charge baseline_private.charges;
begin
 if not baseline_private.active_member() then raise exception 'Member sign-in required'; end if;
 if paid is null then raise exception 'Confirm whether you transferred the funds'; end if;
 if not exists(select 1 from public.baseline_rsvps r where r.event_id=event and r.user_id=uid and r.attending and not r.reserve)
 then raise exception 'Confirm your place before reporting a transfer'; end if;
 select * into charge from baseline_private.charges c where c.event_id=event and c.user_id=uid for update;
 if charge.id is null then raise exception 'Your event charge is not ready. Contact an organiser'; end if;
 if charge.received>=charge.amount then raise exception 'This payment has already been confirmed'; end if;
 update baseline_private.charges set reported=paid,revision=revision+1,updated_at=now() where id=charge.id;
 insert into baseline_private.operation_audit(actor,action,details)
 values(uid,'transfer_confirmation',jsonb_build_object('charge_id',charge.id,'event_id',event,'reported',paid));
end $$;
create function public.baseline_set_transfer_confirmation(event bigint,paid boolean)
returns void language sql security invoker set search_path='' as $$
 select baseline_private.set_transfer_confirmation(event,paid);
$$;
revoke all on function baseline_private.set_transfer_confirmation(bigint,boolean),public.baseline_set_transfer_confirmation(bigint,boolean) from public,anon;
grant execute on function baseline_private.set_transfer_confirmation(bigint,boolean),public.baseline_set_transfer_confirmation(bigint,boolean) to authenticated;

create function baseline_private.admin_confirm_event_payment(charge_id bigint,expected_revision integer)
returns void language plpgsql security definer set search_path='' as $$
declare charge baseline_private.charges;
begin
 if not baseline_private.active_member() or not public.is_admin() then raise exception 'Organiser access required'; end if;
 select * into charge from baseline_private.charges where id=charge_id for update;
 if charge.id is null or charge.revision is distinct from expected_revision then raise exception 'Payment changed. Refresh the list'; end if;
 if charge.event_id is null or not charge.reported or charge.received>=charge.amount then raise exception 'No pending event transfer to confirm'; end if;
 if not exists(select 1 from public.baseline_rsvps r where r.event_id=charge.event_id and r.user_id=charge.user_id and r.attending and not r.reserve)
 then raise exception 'This player is not confirmed for the event. Review the charge manually'; end if;
 update baseline_private.charges set received=amount,reported=false,revision=revision+1,updated_at=now() where id=charge.id;
 insert into baseline_private.operation_audit(actor,action,details)
 values(auth.uid(),'confirm_event_payment',jsonb_build_object('charge_id',charge.id,'event_id',charge.event_id,'user_id',charge.user_id,'amount',charge.amount,'previous_received',charge.received));
end $$;
create function public.baseline_admin_confirm_event_payment(charge_id bigint,expected_revision integer)
returns void language sql security invoker set search_path='' as $$
 select baseline_private.admin_confirm_event_payment(charge_id,expected_revision);
$$;
revoke all on function baseline_private.admin_confirm_event_payment(bigint,integer),public.baseline_admin_confirm_event_payment(bigint,integer) from public,anon;
grant execute on function baseline_private.admin_confirm_event_payment(bigint,integer),public.baseline_admin_confirm_event_payment(bigint,integer) to authenticated;
