begin;

create schema if not exists private;
create table if not exists private.clinic_workspace_invites (
  token_hash bytea primary key,
  account_id uuid not null references public.clinic_accounts(id) on delete cascade,
  location_id uuid not null,
  recipient_email text not null,
  invited_by uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('staff', 'admin')),
  channel text not null check (channel in ('website_chat', 'facebook_messenger', 'ai_phone')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  foreign key (location_id, account_id) references public.clinic_locations(id, account_id) on delete cascade
);
alter table private.clinic_workspace_invites enable row level security;
revoke all on private.clinic_workspace_invites from public, anon, authenticated;
create index if not exists clinic_workspace_invites_issuer_time
  on private.clinic_workspace_invites(invited_by, created_at);

create or replace function public.create_clinic_workspace_invite(
  p_account_id uuid, p_location_id uuid, p_email text, p_role text, p_channel text
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  issuer uuid := auth.uid();
  recipient text := lower(trim(p_email));
  token text;
begin
  if issuer is null or recipient is null or length(recipient) > 160
    or recipient !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
    or p_role is null or p_role not in ('staff', 'admin')
    or p_channel is null or p_channel not in ('website_chat', 'facebook_messenger', 'ai_phone') then
    raise exception 'Check the invitation details.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.clinic_memberships m
    join public.clinic_locations l on l.account_id = m.account_id
    where m.account_id = p_account_id and l.id = p_location_id
      and m.user_id = issuer and m.role = 'owner'
  ) then
    raise exception 'Only a clinic owner can invite a teammate.' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(issuer::text, 0));
  if (select count(*) from private.clinic_workspace_invites
      where invited_by = issuer and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Invitation limit reached. Try again later.' using errcode = 'P0001';
  end if;
  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into private.clinic_workspace_invites
    (token_hash, account_id, location_id, recipient_email, invited_by, role, channel, expires_at)
  values (sha256(convert_to(token, 'UTF8')), p_account_id, p_location_id, recipient, issuer,
    p_role, p_channel, now() + interval '2 hours');
  return token;
end;
$$;
revoke all on function public.create_clinic_workspace_invite(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.create_clinic_workspace_invite(uuid, uuid, text, text, text) to authenticated;

create or replace function public.accept_clinic_workspace_invite(p_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  recipient uuid := auth.uid();
  verified_email text;
  invitation private.clinic_workspace_invites%rowtype;
begin
  if recipient is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'This clinic invitation is unavailable.' using errcode = '22023';
  end if;
  select lower(u.email) into verified_email from auth.users u
    where u.id = recipient and u.email_confirmed_at is not null;
  update private.clinic_workspace_invites i set accepted_at = now()
    where i.token_hash = sha256(convert_to(p_token, 'UTF8')) and i.recipient_email = verified_email
      and i.accepted_at is null and i.expires_at > now()
      and exists (select 1 from public.clinic_memberships m where m.account_id = i.account_id
        and m.user_id = i.invited_by and m.role = 'owner')
    returning i.* into invitation;
  if not found then
    raise exception 'This invitation is expired, used, or for another email address.' using errcode = '22023';
  end if;
  insert into public.clinic_memberships(account_id, user_id, role)
    values (invitation.account_id, recipient, invitation.role)
    on conflict (account_id, user_id) do nothing;
  return jsonb_build_object('accountId', invitation.account_id, 'locationId', invitation.location_id, 'channel', invitation.channel);
end;
$$;
revoke all on function public.accept_clinic_workspace_invite(text) from public, anon;
grant execute on function public.accept_clinic_workspace_invite(text) to authenticated;

commit;
