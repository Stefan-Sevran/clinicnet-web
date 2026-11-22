begin;

create schema if not exists clinic_operations_private;
revoke all on schema clinic_operations_private from public, anon, authenticated;

-- Provision named Eden identities and finance assignments through a trusted operator.
create table clinic_operations_private.operators (
  user_id uuid primary key references auth.users(id),
  active boolean not null default true
);
create table clinic_operations_private.finance_locations (
  user_id uuid references clinic_operations_private.operators,
  location_id uuid references public.clinic_locations(id),
  primary key (user_id, location_id)
);
create table clinic_operations_private.support_grants (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.clinic_locations(id),
  operator_id uuid not null references clinic_operations_private.operators,
  approved_by uuid not null references auth.users(id),
  scope text not null check (scope in ('read','messenger_facts')),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index support_grants_location on clinic_operations_private.support_grants(location_id, operator_id, expires_at);
create table clinic_operations_private.support_activity (
  id bigint generated always as identity primary key,
  grant_id uuid not null references clinic_operations_private.support_grants,
  actor_id uuid not null,
  action text not null check (action in ('granted','opened','messenger_facts_changed','revoked')),
  occurred_at timestamptz not null default clock_timestamp(),
  changed_fields text[]
);

create function clinic_operations_private.is_owner(p_location uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.clinic_locations l join public.clinic_memberships m using (account_id)
    where l.id = p_location and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

create function public.eden_grant_support(p_location uuid,p_operator_email text,p_scope text,p_hours integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare operator_id uuid; grant_id uuid;
begin
  if not clinic_operations_private.is_owner(p_location) then
    raise exception 'Clinic owner approval required' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('read','messenger_facts') or p_hours is null or p_hours not between 1 and 24 then
    raise exception 'Choose read or Messenger facts access for 1 to 24 hours' using errcode = '22023';
  end if;
  select o.user_id into operator_id from clinic_operations_private.operators o
    join auth.users u on u.id = o.user_id
    where o.active and lower(u.email) = lower(btrim(p_operator_email)) and u.email_confirmed_at is not null;
  if not found then raise exception 'Eden support identity unavailable' using errcode = '22023'; end if;
  insert into clinic_operations_private.support_grants(location_id,operator_id,approved_by,scope,expires_at)
    values(p_location,operator_id,auth.uid(),p_scope,clock_timestamp() + make_interval(hours => p_hours))
    returning id into grant_id;
  insert into clinic_operations_private.support_activity(grant_id,actor_id,action) values(grant_id,auth.uid(),'granted');
  return grant_id;
end $$;

create function public.eden_revoke_support(p_grant uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from clinic_operations_private.support_grants g
    where g.id = p_grant and clinic_operations_private.is_owner(g.location_id)) then
    raise exception 'Clinic owner approval required' using errcode = '42501';
  end if;
  update clinic_operations_private.support_grants set revoked_at = clock_timestamp()
    where id = p_grant and revoked_at is null;
  if found then
    insert into clinic_operations_private.support_activity(grant_id,actor_id,action) values(p_grant,auth.uid(),'revoked');
  end if;
end $$;

create function public.eden_support_locations()
returns table(grant_id uuid, location_id uuid, account_id uuid, account_name text, location_name text, scope text, expires_at timestamptz)
language sql security definer set search_path = '' as $$
  select g.id,l.id,l.account_id,a.name,l.name,g.scope,g.expires_at
  from clinic_operations_private.support_grants g
  join clinic_operations_private.operators o on o.user_id = g.operator_id
  join public.clinic_locations l on l.id = g.location_id
  join public.clinic_accounts a on a.id = l.account_id
  where g.operator_id = auth.uid() and o.active and g.revoked_at is null and g.expires_at > clock_timestamp()
  order by l.name, g.expires_at desc;
$$;

create function public.eden_support_activity(p_location uuid)
returns table(grant_id uuid, operator_email text, scope text, expires_at timestamptz, revoked_at timestamptz,
  actor_id uuid, action text, occurred_at timestamptz, changed_fields text[])
language plpgsql security definer set search_path = '' as $$
begin
  if not clinic_operations_private.is_owner(p_location) then
    raise exception 'Clinic owner approval required' using errcode = '42501';
  end if;
  return query select g.id,u.email::text,g.scope,g.expires_at,g.revoked_at,a.actor_id,a.action,a.occurred_at,a.changed_fields
    from clinic_operations_private.support_grants g join auth.users u on u.id = g.operator_id
    join clinic_operations_private.support_activity a on a.grant_id = g.id
    where g.location_id = p_location order by a.id desc;
end $$;

-- This entry point never grants membership, a clinic session, or access to patient records.
create function public.eden_support_messenger_facts(p_grant uuid,p_facts jsonb default null,p_expected jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare access_grant clinic_operations_private.support_grants;
  current_facts jsonb; next_facts jsonb; field text; value text; changed text[] := '{}';
begin
  select g.* into access_grant from clinic_operations_private.support_grants g
    join clinic_operations_private.operators o on o.user_id = g.operator_id
    where g.id = p_grant and o.active and g.operator_id = auth.uid()
    and g.revoked_at is null and g.expires_at > clock_timestamp() for share of g,o;
  if not found or access_grant.expires_at <= clock_timestamp() or
    (p_facts is not null and access_grant.scope <> 'messenger_facts') then
    raise exception 'This support grant does not allow that action' using errcode = '42501';
  end if;
  -- Return only the patient-facing fields covered by the support grant.
  select jsonb_build_object('services',l.messenger_facts->'services','hours',l.messenger_facts->'hours',
    'address',l.messenger_facts->'address','bookingRules',l.messenger_facts->'bookingRules')
    into current_facts from public.clinic_locations l where l.id = access_grant.location_id;
  if p_facts is null then
    insert into clinic_operations_private.support_activity(grant_id,actor_id,action) values(p_grant,auth.uid(),'opened');
    return current_facts;
  end if;
  if jsonb_typeof(p_facts) <> 'object' or p_facts - array['services','hours','address','bookingRules'] <> '{}'::jsonb then
    raise exception 'Only Messenger services, hours, address and booking instructions may be edited' using errcode = '22023';
  end if;
  select l.messenger_facts into next_facts from public.clinic_locations l where l.id = access_grant.location_id for update;
  if access_grant.expires_at <= clock_timestamp() then raise exception 'Support grant expired' using errcode = '42501'; end if;
  if current_facts is distinct from p_expected or exists (
    select 1 from jsonb_each(current_facts) f where f.value is distinct from coalesce(next_facts->f.key,'null'::jsonb)
  ) then
    raise exception 'Clinic facts changed. Reload before saving.' using errcode = '40001';
  end if;
  foreach field in array array['services','hours','address','bookingRules'] loop
    value := btrim(p_facts->>field);
    if jsonb_typeof(p_facts->field) is distinct from 'string' or coalesce(length(value),0) not between 1 and 900 then
      raise exception 'Enter 1–900 characters for each clinic fact' using errcode = '22023';
    end if;
    if to_jsonb(value) is distinct from current_facts->field then changed := array_append(changed,field); end if;
  end loop;
  if cardinality(changed) > 0 then
    current_facts := (select jsonb_object_agg(f.key,btrim(f.value)) from jsonb_each_text(p_facts) f);
    update public.clinic_locations set messenger_facts =
      coalesce(next_facts,'{}'::jsonb) || current_facts || jsonb_build_object('profileApprovedAt',clock_timestamp())
      where id = access_grant.location_id;
    insert into clinic_operations_private.support_activity(grant_id,actor_id,action,changed_fields)
      values(p_grant,auth.uid(),'messenger_facts_changed',changed);
  end if;
  return current_facts;
end $$;

-- A proposal does not take effect until the clinic owner accepts it.
create table clinic_operations_private.rescue_terms (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.clinic_locations(id),
  kind text not null check (kind in ('initial','rate','free_week')),
  effective_on date not null,
  rate_bps integer check (rate_bps between 0 and 10000),
  proposed_by uuid not null references auth.users(id),
  proposed_at timestamptz not null default clock_timestamp(),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  withdrawn_at timestamptz,
  check ((kind='free_week') = (rate_bps is null))
);
create unique index rescue_terms_unique_date on clinic_operations_private.rescue_terms(location_id,kind,effective_on)
  where withdrawn_at is null;
create unique index rescue_terms_unique_initial on clinic_operations_private.rescue_terms(location_id)
  where kind='initial' and withdrawn_at is null;

create function clinic_operations_private.can_manage_terms(p_location uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from clinic_operations_private.finance_locations f
    join clinic_operations_private.operators o using (user_id)
    where f.user_id = auth.uid() and o.active and f.location_id = p_location);
$$;

create function public.eden_finance_locations()
returns table(location_id uuid, account_name text, location_name text)
language sql stable security definer set search_path = '' as $$
  select l.id,a.name,l.name from clinic_operations_private.finance_locations f
  join clinic_operations_private.operators o using (user_id)
  join public.clinic_locations l on l.id=f.location_id
  join public.clinic_accounts a on a.id=l.account_id
  where f.user_id=auth.uid() and o.active order by a.name,l.name;
$$;

create function public.eden_propose_rescue_terms(p_location uuid,p_kind text,p_effective_on date,p_rate_bps integer default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare loc public.clinic_locations; proposal uuid;
begin
  if not clinic_operations_private.can_manage_terms(p_location) then
    raise exception 'Eden finance assignment required' using errcode = '42501';
  end if;
  select * into loc from public.clinic_locations where id = p_location for update;
  if p_effective_on is null or not isfinite(p_effective_on) or p_effective_on <= (clock_timestamp() at time zone loc.timezone)::date then
    raise exception 'Choose a future clinic date' using errcode = '22023';
  end if;
  if p_kind = 'initial' and exists (select 1 from public.clinic_rescue_settings where location_id = p_location) then
    raise exception 'This clinic already has reporting terms' using errcode = '22023';
  end if;
  if p_kind in ('rate','free_week') and not exists (select 1 from public.clinic_rescue_settings where location_id = p_location) then
    raise exception 'Start reporting before proposing an amendment' using errcode = '22023';
  end if;
  update clinic_operations_private.rescue_terms set withdrawn_at=clock_timestamp()
    where location_id=p_location and kind=p_kind and accepted_at is null and withdrawn_at is null
      and (kind='initial' or effective_on=p_effective_on);
  insert into clinic_operations_private.rescue_terms(location_id,kind,effective_on,rate_bps,proposed_by)
    values(p_location,p_kind,p_effective_on,p_rate_bps,auth.uid()) returning id into proposal;
  return proposal;
end $$;

create function public.eden_review_rescue_terms(p_location uuid)
returns table(id uuid,kind text,effective_on date,rate_bps integer,accepted_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not (clinic_operations_private.can_manage_terms(p_location) or exists (
    select 1 from public.clinic_locations l join public.clinic_memberships m using (account_id)
    where l.id=p_location and m.user_id=auth.uid() and m.role in ('owner','admin')
  )) then
    raise exception 'Clinic manager or assigned Eden finance access required' using errcode = '42501';
  end if;
  return query select t.id,t.kind,t.effective_on,t.rate_bps,t.accepted_at
    from clinic_operations_private.rescue_terms t where t.location_id = p_location and t.withdrawn_at is null
    order by t.effective_on desc,t.kind;
end $$;

create function public.eden_accept_rescue_terms(p_location uuid,p_terms uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare proposal clinic_operations_private.rescue_terms; loc public.clinic_locations;
begin
  if not clinic_operations_private.is_owner(p_location) then
    raise exception 'Clinic owner approval required' using errcode = '42501';
  end if;
  select * into loc from public.clinic_locations where id = p_location for update;
  select * into proposal from clinic_operations_private.rescue_terms
    where id = p_terms and location_id = p_location and withdrawn_at is null for update;
  if not found then raise exception 'Terms unavailable for this location' using errcode = '42501'; end if;
  if proposal.proposed_by = auth.uid() then
    raise exception 'A separate clinic owner must confirm the proposed terms' using errcode = '42501';
  end if;
  if proposal.accepted_at is not null then return; end if;
  if proposal.effective_on <= (clock_timestamp() at time zone loc.timezone)::date then
    raise exception 'These terms have expired. Ask Eden for a new effective date.' using errcode = '22023';
  end if;
  update clinic_operations_private.rescue_terms set accepted_at = clock_timestamp(), accepted_by = auth.uid() where id = p_terms;
end $$;

revoke all on function public.eden_grant_support(uuid,text,text,integer),public.eden_revoke_support(uuid),
  public.eden_support_locations(),public.eden_support_activity(uuid),public.eden_support_messenger_facts(uuid,jsonb,jsonb),
  public.eden_finance_locations(),public.eden_propose_rescue_terms(uuid,text,date,integer),public.eden_review_rescue_terms(uuid),
  public.eden_accept_rescue_terms(uuid,uuid) from public,anon,authenticated;
grant execute on function public.eden_grant_support(uuid,text,text,integer),public.eden_revoke_support(uuid),
  public.eden_support_locations(),public.eden_support_activity(uuid),public.eden_support_messenger_facts(uuid,jsonb,jsonb),
  public.eden_finance_locations(),public.eden_propose_rescue_terms(uuid,text,date,integer),public.eden_review_rescue_terms(uuid),
  public.eden_accept_rescue_terms(uuid,uuid) to authenticated;

-- Only locations with an Eden initial proposal enter the new activation path.
create function clinic_operations_private.confirm_initial_terms()
returns trigger language plpgsql security definer set search_path = '' as $$
declare agreed clinic_operations_private.rescue_terms;
begin
  select * into agreed from clinic_operations_private.rescue_terms where location_id=new.location_id and kind='initial' and withdrawn_at is null;
  if found and (agreed.accepted_at is null or (new.pilot_start,new.rate_bps) is distinct from (agreed.effective_on,agreed.rate_bps)) then
    raise exception 'Confirm the agreed start and Eden share before activating reporting' using errcode='22023';
  end if;
  return new;
end $$;

create trigger confirm_initial_rescue_terms before insert or update on public.clinic_rescue_settings
for each row execute function clinic_operations_private.confirm_initial_terms();

-- The visit date fixes its rate, so a later payment or refund keeps the original terms.
create function clinic_operations_private.visit_terms(p_location uuid,p_base_rate integer,p_paid_start date,
  p_request date,p_visit date)
returns table(rate_bps integer,billable boolean)
language sql stable set search_path = '' as $$
  with terms as (
    select coalesce((select t.rate_bps from clinic_operations_private.rescue_terms t
      where t.location_id=p_location and t.kind='rate' and t.accepted_at is not null
        and t.effective_on<=p_visit order by t.effective_on desc limit 1),p_base_rate) rate_bps,
      p_request>=p_paid_start and p_visit>=p_paid_start and not exists (
        select 1 from clinic_operations_private.rescue_terms t
        where t.location_id=p_location and t.kind='free_week' and t.accepted_at is not null
          and p_visit>=t.effective_on and p_visit<t.effective_on+7
      ) billable
  )
  select case when billable then rate_bps else 0 end,billable from terms;
$$;

CREATE OR REPLACE FUNCTION clinic_rescue_private.summary(s clinic_rescue_settings, k text, a date, b date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with bounds as (select a::timestamp at time zone s.timezone lo,b::timestamp at time zone s.timezone hi,
 s.pilot_start+7 as paid_start),
 requests as (
 select e.*,f.action,f.appointment_at,exists(select 1 from clinic_rescue_private.visit_entries j join public.clinic_visit_completions v using(event_key)
 where j.eden_event_key=e.event_key and j.location_id=e.location_id
   and v.account_id=e.account_id and v.location_id=e.location_id and j.posted_at<hi
   and clinic_rescue_private.valid_attribution(e,v.appointment_at)) as attended from public.clinic_outcomes e cross join bounds
 left join lateral(select x.action,x.appointment_at from public.clinic_followup_actions x
 where (x.event_key,x.account_id,x.location_id)=(e.event_key,e.account_id,e.location_id) and x.created_at<hi
 order by x.created_at desc,x.id desc limit 1) f on true
 where e.location_id=s.location_id and e.account_id=s.account_id and e.occurred_at<hi and clinic_rescue_private.eligible(e)
 ),
 receipts as (
 select j.*,v.appointment_at,src.occurred_at as request_at,src.channel,
   terms.billable, terms.rate_bps
 from clinic_rescue_private.visit_entries j
 join public.clinic_visit_completions v on (v.event_key,v.location_id)=(j.event_key,j.location_id)
 join public.clinic_outcomes src on (src.event_key,src.account_id,src.location_id)=(j.eden_event_key,v.account_id,v.location_id)
 cross join bounds
 cross join lateral clinic_operations_private.visit_terms(s.location_id,s.rate_bps,paid_start,
   (src.occurred_at at time zone s.timezone)::date,(v.appointment_at at time zone s.timezone)::date) terms
 where j.location_id=s.location_id and v.account_id=s.account_id and j.posted_at<hi and j.currency=s.currency
   and clinic_rescue_private.valid_attribution(src,v.appointment_at)
 ),
 period_visits as (
   select event_key,eden_event_key,channel,request_at,appointment_at,billable,rate_bps,sum(delta_minor) as amount_minor
   from receipts cross join bounds
   where posted_at>=lo and amount_minor is not null
   group by event_key,eden_event_key,channel,request_at,appointment_at,billable,rate_bps
 ),
 -- Allocate fee rounding across visit rows so they reconcile to the estimate.
 visit_fees as (
   select *, sum(amount_minor * rate_bps) over (order by appointment_at,event_key) as running_minor
   from period_visits
 ),
 totals as (
 select coalesce(sum(delta_minor) filter(where posted_at>=lo),0) collected,
 coalesce(sum(delta_minor) filter(where posted_at>=lo and billable),0) eligible,
 coalesce(sum(delta_minor::numeric * rate_bps) filter(where posted_at>=lo),0) period_weighted,
 coalesce(sum(delta_minor::numeric * rate_bps),0) lifetime_weighted
 from receipts cross join bounds
 ),
 prior_months as (
 select date_trunc('month',posted_at at time zone s.timezone) mon,sum(delta_minor::numeric * rate_bps) total
 from receipts,bounds where posted_at<lo and billable group by 1
 ),
 prior_balances as (select sum(total) over(order by mon) balance from prior_months),
 fee as (
 select round(lifetime_weighted/10000) - greatest(0,coalesce((select round(max(balance)/10000) from prior_balances),0)) balance from totals
 ),
 visits as (
 select v.event_key,j.amount_minor,j.currency,
   clinic_rescue_private.valid_attribution(src,v.appointment_at) as attributed from public.clinic_visit_completions v cross join bounds
 join lateral(select e.* from clinic_rescue_private.visit_entries e where e.event_key=v.event_key and e.location_id=v.location_id and e.posted_at<hi
 order by e.revision desc limit 1) j on true
 left join public.clinic_outcomes src
   on (src.event_key,src.account_id,src.location_id)=(j.eden_event_key,v.account_id,v.location_id)
 where v.location_id=s.location_id and v.account_id=s.account_id and v.completed_at>=lo and v.completed_at<hi
 )
 select jsonb_build_object(
 'currency',s.currency,'rate_bps',s.rate_bps,'free_through',s.pilot_start+6,
 'channels',coalesce((select jsonb_object_agg(channel,n) from
 (select channel,count(*) n from requests,bounds where occurred_at>=lo group by channel) c),'{}'::jsonb),
 'confirmed',(select count(*) from requests,bounds where occurred_at>=lo and (attended or (action in ('booked','rescheduled','restored') and (appointment_at is null or appointment_at>=occurred_at)))),
 'outstanding',(select count(*) from requests where not attended and (action is null or action in ('reopened','claimed'))),
 'completed',(select count(*) from visits),'attributed',(select count(*) from visits where attributed),
 'amount_pending',(select count(*) from visits where amount_minor is null),
 'other_currency',(select count(*) from visits where amount_minor is not null and currency<>s.currency),
 'collected_minor',collected,'eligible_minor',eligible,
 'share_minor',case when k='settlement' then greatest(0,balance) else 0 end,
 'credit_minor',case when k='settlement' then greatest(0,-balance) else 0 end,
 'estimated_share_minor', round(period_weighted/10000),
 'counted_visits',coalesce((select jsonb_agg(jsonb_build_object(
   'ref',left(encode(sha256(convert_to(eden_event_key,'UTF8')),'hex'),10),
   'channel',channel,'inquiry_at',request_at,'visit_at',appointment_at,
   'amount_minor',amount_minor,'free',not billable,'rate_bps',rate_bps,
   'estimated_fee_minor',case when billable then
     round(running_minor/10000) - round((running_minor-amount_minor*rate_bps)/10000)
     else 0 end)
   order by appointment_at,event_key) from visit_fees),'[]'::jsonb),
 'entries',coalesce((select jsonb_agg(jsonb_build_object(
   'ref',coalesce(j.receipt_ref,left(encode(sha256(convert_to(j.event_key,'UTF8')),'hex'),10)),
   'channel',j.channel,'posted',j.posted_at,'delta_minor',j.delta_minor,'free',not j.billable)
   order by j.posted_at,j.event_key,j.revision)
   from receipts j cross join bounds where j.posted_at>=lo and j.amount_minor is not null),'[]'::jsonb)
 ) from totals,fee
$function$;

commit;
