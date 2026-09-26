do $migration$
declare definition text; marker text:=$marker$  insert into baseline_private.committee_items(kind,description,owner,amount,quantity,note,receipt_path,created_by)$marker$;
begin
 select pg_get_functiondef('baseline_private.finance(text,jsonb)'::regprocedure) into definition;
 if position(marker in definition)=0 then raise exception 'Finance definition changed'; end if;
 definition:=replace(definition,marker,$guard$  select * into item from baseline_private.committee_items where receipt_path=receipt and created_by=uid;
  if item.id is not null then return to_jsonb(item); end if;
$guard$||marker);
 execute definition;
end $migration$;
