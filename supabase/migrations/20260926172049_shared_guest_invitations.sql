-- One unguessable, single-use invite per guest; all personal details stay private.
alter table public.baseline_members add column invite_only boolean not null default false;
drop policy "Public scoreboard names" on public.baseline_members;
create policy "Public scoreboard names" on public.baseline_members for select to anon,authenticated using(not invite_only or (select public.is_admin()) or exists(select 1 from public.baseline_member_accounts a where a.member_id=id and a.user_id=(select auth.uid())));
create or replace function baseline_private.member_roster() returns table(id uuid,name text,claimed boolean) language sql stable security definer set search_path='' as $$
 select m.id,m.name,exists(select 1 from public.baseline_member_accounts a where a.member_id=m.id) from public.baseline_members m where not m.invite_only order by m.name;
$$;
create table baseline_private.guest_links(token uuid primary key default gen_random_uuid(),event_id bigint not null references public.baseline_events(id),host_id uuid not null references public.profiles(id),claimed_by uuid references public.profiles(id),revoked boolean not null default false,created_at timestamptz not null default now());
create index guest_links_host on baseline_private.guest_links(host_id,event_id);
create index guest_links_claimed on baseline_private.guest_links(claimed_by);
alter table baseline_private.guest_links enable row level security;
revoke all on baseline_private.guest_links from public,anon,authenticated;
alter table baseline_private.guest_requests add column user_id uuid references public.profiles(id),add column link_token uuid unique references baseline_private.guest_links(token);
create unique index guest_event_account on baseline_private.guest_requests(event_id,user_id) where user_id is not null;
alter table public.baseline_rsvps add column guest_host_id uuid references public.profiles(id);
create index baseline_rsvp_guest_host on public.baseline_rsvps(guest_host_id);
-- A link-supplied guest becomes a guest account before any annual fee is considered.
create or replace function baseline_private.link_new_operations() returns trigger language plpgsql security definer set search_path='' as $$
declare invitation baseline_private.guest_requests; config baseline_private.operations_settings;
begin
 select * into invitation from baseline_private.guest_requests where member_id=new.member_id and (status='approved' or link_token is not null) order by created_at desc limit 1;
 insert into baseline_private.member_types(user_id,category) values(new.user_id,case when invitation.id is null then 'member' else 'guest' end) on conflict(user_id) do nothing;
 if invitation.status='approved' and invitation.approved_handicap is not null then update public.profiles set handicap=invitation.approved_handicap where id=new.user_id; end if;
 select * into config from baseline_private.operations_settings;
 if invitation.id is null and config.membership_fee is not null then
 insert into baseline_private.charges(user_id,scope,label,amount,due_date) values(new.user_id,'membership:2027','2027 membership',config.membership_fee,config.membership_due) on conflict(user_id,scope) do nothing;end if;
 return new;
end $$;
-- Internal only: called by the account trigger or by the authenticated invite endpoint.
create function baseline_private.accept_guest(invite uuid,who uuid,payload jsonb,creating boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare l baseline_private.guest_links;ev public.baseline_events;p public.profiles;rid uuid;g baseline_private.guest_requests;r public.baseline_rsvps;h numeric;occupied int;candidate record;pref text;needs_buggy boolean;
begin
 select * into l from baseline_private.guest_links where token=invite for update;
 if l.token is null or l.revoked then raise exception 'This invitation is unavailable. Ask your host for a new link';end if;
 if l.claimed_by is not null and l.claimed_by<>who then raise exception 'This invitation has already been used';end if;
 if l.host_id=who then raise exception 'This is your invitation. Share it with your guest';end if;
 if not exists(select 1 from public.baseline_member_accounts where user_id=l.host_id and not disabled) then raise exception 'This invitation is unavailable';end if;
 if l.claimed_by=who then
 select * into r from public.baseline_rsvps where event_id=l.event_id and user_id=who;
 return jsonb_build_object('event_id',l.event_id,'attending',r.attending,'reserve',r.reserve,'already_joined',true);
 end if;
 select * into ev from public.baseline_events where id=l.event_id for update;
 if ev.id is null or ev.cancelled or ev.date<(now() at time zone 'Europe/London')::date or (ev.rsvp_deadline is not null and ev.rsvp_deadline<(now() at time zone 'Europe/London')::date) then raise exception 'Bookings for this round are closed';end if;
 if ev.guest_price is null then raise exception 'The organiser needs to set the guest price before guests can join';end if;
 if length(coalesce(ev.cancellation_terms,''))>0 and (payload->>'accept_terms' is distinct from 'true' or payload->>'terms_snapshot' is distinct from ev.cancellation_terms) then raise exception 'Read and accept the current cancellation terms';end if;
 if (payload->>'guest_price')::numeric is distinct from ev.guest_price then raise exception 'The guest price has changed. Reload the invitation before joining';end if;
 select * into p from public.profiles where id=who;
 if p.id is null then raise exception 'Account not found';end if;
 if p.phone is null or p.phone !~ '^\+?[0-9 ()-]{10,25}$' or length(regexp_replace(p.phone,'[^0-9]','','g')) not between 10 and 15 then raise exception 'Enter a valid mobile number';end if;
 if not creating and not exists(select 1 from public.baseline_member_accounts where user_id=who and not disabled and member_id is not null) then raise exception 'Complete your account first';end if;
 if not creating and exists(select 1 from public.baseline_rsvps where event_id=ev.id and user_id=who) then raise exception 'You already have an RSVP for this round. Manage it on the event page';end if;
 h:=(payload->>'guest_handicap')::numeric;
 if ev.event_type<>'social' and (h is null or h::text in ('NaN','Infinity','-Infinity') or h<0 or h>54 or round(h,1)<>h) then raise exception 'Enter your handicap from 0 to 54 with at most one decimal place';end if;
 if creating then
 if length(trim(p.full_name)) not between 2 and 150 or p.full_name ~ '[[:cntrl:]]' then raise exception 'Enter your full name';end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(trim(p.full_name)),2027));
 if exists(select 1 from public.baseline_members where lower(trim(name))=lower(trim(p.full_name))) then raise exception 'This name is already listed. Sign in with your existing account or contact an organiser';end if;
 if exists(select 1 from public.profiles x where x.id<>who and regexp_replace(x.phone,'[^0-9]','','g')=regexp_replace(p.phone,'[^0-9]','','g')) then raise exception 'This mobile number already has an account. Sign in or contact an organiser';end if;
 insert into public.baseline_members(name,invite_only) values(trim(p.full_name),true) returning id into rid;
 else select member_id into rid from public.baseline_member_accounts where user_id=who;end if;
 insert into baseline_private.guest_requests(host_id,event_id,name,phone,requested_handicap,status,member_id,user_id,link_token)
 values(l.host_id,ev.id,trim(p.full_name),p.phone,h,case when ev.event_type='social' or p.handicap is not null then 'approved' else 'pending' end,rid,who,invite);
 if creating then insert into public.baseline_member_accounts(user_id,member_id) values(who,rid);end if;
 update baseline_private.guest_links set claimed_by=who where token=invite;
 needs_buggy:=ev.event_type<>'social' and coalesce((payload->>'buggy')::boolean,false);
 pref:=case when ev.event_type<>'social' then nullif(payload->>'preferred_time','') end;
 if pref is not null and pref not in ('First','Middle','End') then raise exception 'Choose a valid tee time preference';end if;
 insert into public.baseline_rsvps(event_id,user_id,name,attending,reserve,buggy,preferred_time,guest_host_id,terms_accepted_at,terms_snapshot)
 values(ev.id,who,trim(p.full_name)||' (guest)',false,true,needs_buggy,pref,l.host_id,case when payload->>'accept_terms'='true' then now() end,ev.cancellation_terms) returning * into r;
 insert into public.baseline_rsvp_contacts(rsvp_id,phone) values(r.id,p.phone);
 select count(*) into occupied from public.baseline_rsvps where event_id=ev.id and attending and not reserve;
 for candidate in select id from public.baseline_rsvps where event_id=ev.id and reserve order by requested_at,id loop
 exit when ev.max_players is not null and occupied>=ev.max_players;
 update public.baseline_rsvps set attending=true,reserve=false,updated_at=now() where id=candidate.id;occupied:=occupied+1;
 end loop;
 if exists(select 1 from public.baseline_tee_times where event_id=ev.id) then update public.baseline_events set tee_times_dirty=true where id=ev.id;end if;
 select * into r from public.baseline_rsvps where id=r.id;
 return jsonb_build_object('event_id',ev.id,'attending',r.attending,'reserve',r.reserve,'already_joined',false);
end $$;
revoke all on function baseline_private.accept_guest(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
create or replace function baseline_private.new_member() returns trigger language plpgsql security definer set search_path='' as $$
declare meta jsonb;n text;who uuid;
begin
 select raw_user_meta_data into meta from auth.users where id=new.id;
 if meta->>'guest_token' is not null then
 perform baseline_private.accept_guest((meta->>'guest_token')::uuid,new.id,meta,true);return new;end if;
 who:=(meta->>'roster_id')::uuid;
 if who is null or meta->>'name_confirmation' is distinct from 'true' then raise exception 'Choose your own scoreboard name and confirm it';end if;
 if new.phone is null or new.phone !~ '^\+?[0-9 ()-]{10,25}$' or length(regexp_replace(new.phone,'[^0-9]','','g')) not between 10 and 15 then raise exception 'Enter a valid mobile number';end if;
 select name into n from public.baseline_members where id=who and not invite_only for update;
 if n is null then raise exception 'Choose your name from the list';end if;
 if exists(select 1 from public.baseline_member_accounts where member_id=who) then raise exception 'This name already has an account';end if;
 insert into public.baseline_member_accounts(user_id,member_id) values(new.id,who);
 update public.profiles set full_name=n where id=new.id;return new;
end $$;
create function baseline_private.guest_invitations(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
 return jsonb_build_object('category',coalesce((select category from baseline_private.member_types where user_id=uid),'member'),'links',coalesce((select jsonb_agg(jsonb_build_object('token',l.token,'claimed',l.claimed_by is not null,'revoked',l.revoked,'guest_name',p.full_name,'event_id',l.event_id) order by l.created_at desc) from baseline_private.guest_links l left join public.profiles p on p.id=l.claimed_by where l.host_id=uid and l.event_id=(payload->>'event_id')::bigint),'[]'::jsonb),'bookings',coalesce((select jsonb_agg(jsonb_build_object('event_id',r.event_id,'host_name',p.full_name,'status',g.status,'requested_handicap',g.requested_handicap,'guest_price',ev.guest_price,'reserve',r.reserve,'attending',r.attending,'event_name',ev.name,'date',ev.date) order by ev.date,ev.id) from public.baseline_rsvps r join public.baseline_events ev on ev.id=r.event_id join public.profiles p on p.id=r.guest_host_id left join baseline_private.guest_requests g on g.event_id=r.event_id and g.user_id=r.user_id where r.user_id=uid and ev.date>=(now() at time zone 'Europe/London')::date and not ev.cancelled),'[]'::jsonb));
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
create function public.baseline_guest_invitations(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select baseline_private.guest_invitations(action,payload);$$;
revoke all on function baseline_private.guest_invitations(text,jsonb),public.baseline_guest_invitations(text,jsonb) from public,anon,authenticated;
grant execute on function baseline_private.guest_invitations(text,jsonb),public.baseline_guest_invitations(text,jsonb) to anon,authenticated;
-- Preserve the guest marker even when a member edits their RSVP later.
create function baseline_private.guest_rsvp_label() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then new.guest_host_id:=old.guest_host_id;end if;
 if new.guest_host_id is not null then new.name:=(select full_name from public.profiles where id=new.user_id)||' (guest)';end if;
 return new;
end $$;
create trigger baseline_guest_rsvp_label before insert or update on public.baseline_rsvps for each row execute function baseline_private.guest_rsvp_label();
revoke all on function baseline_private.guest_rsvp_label() from public,anon,authenticated;

create or replace function baseline_private.sync_charge() returns trigger language plpgsql security definer set search_path='' as $$
declare ev public.baseline_events; cat text; cost numeric;
begin
 select * into ev from public.baseline_events where id=new.event_id;
 cat:=case when new.guest_host_id is not null then 'guest' else coalesce((select category from baseline_private.member_types where user_id=new.user_id),'member') end;
 cost:=case when cat='guest' then ev.guest_price else ev.member_price end;
 if new.attending and not new.reserve and cost is not null then
 insert into baseline_private.charges(user_id,event_id,scope,label,category,amount,due_date) values(new.user_id,new.event_id,'event:'||new.event_id,ev.name,cat,cost,ev.payment_due)
 on conflict(user_id,scope) do update set cancellation_review=false,revision=baseline_private.charges.revision+1;
 elsif tg_op='UPDATE' and old.attending and not old.reserve and not new.attending then
 update baseline_private.charges set cancellation_review=true,revision=revision+1 where user_id=new.user_id and event_id=new.event_id;
 update baseline_private.playing_pairs set status='looking',second_user=null,first_user=case when first_user=new.user_id and second_user is not null then second_user else first_user end,updated_at=now() where event_id=new.event_id and new.user_id in(first_user,second_user);
 delete from baseline_private.playing_pairs where event_id=new.event_id and first_user=new.user_id;
 end if;
 return new;
end $$;
create or replace function baseline_private.event_tee_groups(event bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ev public.baseline_events; groups_json jsonb; secret boolean; provisional boolean;
begin
 if not baseline_private.active_member() then raise exception 'Member sign-in required'; end if;
 select * into ev from public.baseline_events where id=event;
 if ev.id is null then raise exception 'Event not found'; end if;
 if ev.cancelled or ev.tee_times_dirty then return jsonb_build_object('status',case when ev.cancelled then 'cancelled' else 'reviewing' end,'groups','[]'::jsonb); end if;
 secret:=ev.round_number>=7 and not public.is_admin();
 provisional:=exists(select 1 from generate_series(1,ev.round_number-1) n where not exists(select 1 from baseline_private.league_rounds r where r.round_number=n and r.published_entries is not null));
 select coalesce(jsonb_agg(jsonb_build_object('group_number',t.group_number,'tee_time',t.tee_time,'players',(
  select coalesce(jsonb_agg(jsonb_build_object('user_id',p.id,'name',p.full_name||case when exists(select 1 from public.baseline_rsvps gr where gr.event_id=event and gr.user_id=p.id and gr.guest_host_id is not null) then ' (guest)' else '' end,'avatar_path',p.baseline_avatar_path,'handicap',case when secret then null else baseline_private.handicap_at(p.id,coalesce(ev.round_number,1)) end,'handicap_secret',coalesce(secret,false),'type',a.value->>'type') order by a.ordinality),'[]'::jsonb)
  from jsonb_array_elements(t.players) with ordinality a(value,ordinality) join public.profiles p on p.id::text=a.value->>'user_id' join public.baseline_member_accounts m on m.user_id=p.id and not m.disabled
 )) order by t.group_number),'[]'::jsonb) into groups_json from public.baseline_tee_times t where t.event_id=event;
 return jsonb_build_object('status',case when jsonb_array_length(groups_json)=0 then 'unpublished' else 'published' end,'published_at',ev.tee_published_at,'revision',ev.tee_revision,'round_number',ev.round_number,'provisional',case when secret then false else provisional end,'groups',groups_json);
end $$;
