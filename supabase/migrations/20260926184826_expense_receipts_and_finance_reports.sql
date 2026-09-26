alter table baseline_private.committee_items
 add column created_at timestamptz not null default now(),
 add column created_by uuid references public.profiles(id),
 add column receipt_path text,
 add column paid_at timestamptz,
 add column paid_by uuid references public.profiles(id);
create unique index baseline_expense_receipt_unique on baseline_private.committee_items(receipt_path) where receipt_path is not null;
create index baseline_expense_pending on baseline_private.committee_items(created_at desc) where kind='expense' and not done;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('baseline-expense-receipts','baseline-expense-receipts',false,8388608,array['image/jpeg','image/png','image/webp']);
create policy "Admins read expense receipts" on storage.objects for select to authenticated
 using(bucket_id='baseline-expense-receipts' and (select baseline_private.active_member()) and (select public.is_admin()));
create policy "Admins upload own expense receipts" on storage.objects for insert to authenticated
 with check(bucket_id='baseline-expense-receipts' and (select baseline_private.active_member()) and (select public.is_admin()) and (storage.foldername(name))[1]=(select auth.uid())::text);
-- Receipts are immutable once uploaded; no update/delete policy is granted.
create function baseline_private.finance(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); item baseline_private.committee_items; cost numeric; receipt text; result jsonb; before_row jsonb;
begin
 if uid is null or not baseline_private.active_member() or not public.is_admin() then raise exception 'Organiser access required'; end if;
 if action='summary' then
  return jsonb_build_object('pending',(select count(*) from baseline_private.committee_items where kind='expense' and not done));
 elsif action='list' then
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('paid_by_name',p.full_name,'created_by_name',c.full_name) order by i.done,i.created_at desc) from baseline_private.committee_items i left join public.profiles p on p.id=i.paid_by left join public.profiles c on c.id=i.created_by where i.kind='expense'),'[]'::jsonb),
   'charges',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('name',p.full_name) order by c.id) from baseline_private.charges c join public.profiles p on p.id=c.user_id),'[]'::jsonb));
 elsif action='add' then
  if length(trim(coalesce(payload->>'owner','')))=0 or length(payload->>'owner')>150 then raise exception 'Enter the claimant name (up to 150 characters)'; end if;
  if length(trim(coalesce(payload->>'description','')))=0 or length(payload->>'description')>300 then raise exception 'Explain what the expense is for (up to 300 characters)'; end if;
  cost:=(payload->>'amount')::numeric;
  if cost is null or cost::text in ('NaN','Infinity','-Infinity') or cost<=0 or cost>999999.99 or cost<>round(cost,2) then raise exception 'Enter an amount greater than zero with no more than two decimal places'; end if;
  receipt:=payload->>'receipt_path';
  if receipt is null or split_part(receipt,'/',1)<>uid::text or not exists(select 1 from storage.objects where bucket_id='baseline-expense-receipts' and name=receipt and owner_id=uid::text) then raise exception 'Upload your receipt photo before saving'; end if;
  insert into baseline_private.committee_items(kind,description,owner,amount,quantity,note,receipt_path,created_by)
   values('expense',trim(payload->>'description'),trim(payload->>'owner'),cost,1,left(coalesce(payload->>'note',''),1000),receipt,uid) returning * into item;
 elsif action='paid' then
  select * into item from baseline_private.committee_items where id=(payload->>'id')::bigint and kind='expense' for update;
  if item.id is null then raise exception 'Expense not found'; end if;
  if item.done then raise exception 'This expense is already marked paid'; end if;
  if item.revision is distinct from (payload->>'revision')::integer then raise exception 'Expense changed. Refresh before marking paid'; end if;
  before_row:=to_jsonb(item);
  update baseline_private.committee_items set done=true,paid_at=now(),paid_by=uid,updated_at=now(),revision=revision+1 where id=item.id returning * into item;
 else raise exception 'Unknown finance action'; end if;
 insert into baseline_private.operation_audit(actor,action,details) values(uid,'expense_'||action,jsonb_build_object('item_id',item.id,'before',before_row,'after',to_jsonb(item)));
 return to_jsonb(item);
end $$;
create function public.baseline_finance(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select baseline_private.finance(action,payload);$$;
revoke all on function baseline_private.finance(text,jsonb),public.baseline_finance(text,jsonb) from public,anon,authenticated;
grant execute on function baseline_private.finance(text,jsonb),public.baseline_finance(text,jsonb) to authenticated;
-- Close the previous expense-edit path so receipts and payment auditing cannot be bypassed.
do $migration$
declare definition text; marker text:=$marker$elsif action='item' then$marker$;
begin
 select pg_get_functiondef('baseline_private.operations(text,jsonb)'::regprocedure) into definition;
 if position(marker in definition)=0 then raise exception 'Existing operations function differs; review before migrating'; end if;
 definition:=replace(definition,marker,marker||$guard$
   if payload->>'kind'='expense' or exists(select 1 from baseline_private.committee_items where id=(payload->>'id')::bigint and kind='expense') then raise exception 'Use Expenses to upload a receipt or mark an expense paid'; end if;
 $guard$);
 execute definition;
end $migration$;
