-- Team mutations are service-only; the API supplies a verified account ID.
create table public.hdn_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create table public.hdn_team_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  team_id uuid not null references public.hdn_teams(id) on delete cascade,
  role text not null check (role in ('admin', 'user', 'supervisor')),
  created_at timestamptz not null default now()
);
create index hdn_team_members_team_idx on public.hdn_team_members(team_id);
create table public.hdn_team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.hdn_teams(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'user', 'supervisor')),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  unique(team_id, email)
);
alter table public.hdn_checks add column team_id uuid references public.hdn_teams(id) on delete set null;
create index hdn_checks_team_created_idx on public.hdn_checks(team_id, created_at desc, id desc);
-- Keep the membership at lease issuance, never trust a caller's completion metadata.
alter table public.hdn_classification_cache add column lease_team_id uuid references public.hdn_teams(id) on delete set null;

alter table public.hdn_teams enable row level security;
alter table public.hdn_team_members enable row level security;
alter table public.hdn_team_invitations enable row level security;
revoke all on public.hdn_teams, public.hdn_team_members, public.hdn_team_invitations from public, anon, authenticated;
grant all on public.hdn_teams, public.hdn_team_members, public.hdn_team_invitations to service_role;

create function public.hdn_team_context(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare member public.hdn_team_members%rowtype;
begin
  select * into member from public.hdn_team_members where user_id = p_user_id;
  if not found then return jsonb_build_object('team', null, 'members', '[]'::jsonb, 'invitations', '[]'::jsonb); end if;
  return jsonb_build_object(
    'team', (select jsonb_build_object('id', id, 'name', name, 'role', member.role) from public.hdn_teams where id = member.team_id),
    'members', case when member.role = 'admin' then (
      select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'user_id', m.user_id, 'email', u.email,
        'display_name', coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), nullif(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1)),
        'role', m.role) order by m.created_at, m.user_id), '[]'::jsonb)
      from public.hdn_team_members m join auth.users u on u.id = m.user_id where m.team_id = member.team_id
    ) else '[]'::jsonb end,
    'invitations', case when member.role = 'admin' then (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email, 'role', role, 'expires_at', expires_at) order by expires_at), '[]'::jsonb)
      from public.hdn_team_invitations where team_id = member.team_id and accepted_at is null and expires_at > now()
    ) else '[]'::jsonb end
  );
end;
$$;

create function public.hdn_create_team(p_user_id uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare new_team uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 731));
  if not public.hdn_user_active(p_user_id) then return jsonb_build_object('error', 'inactive'); end if;
  if exists(select 1 from public.hdn_team_members where user_id = p_user_id) then return jsonb_build_object('error', 'already_member'); end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then return jsonb_build_object('error', 'invalid'); end if;
  insert into public.hdn_teams(name) values(btrim(p_name)) returning id into new_team;
  insert into public.hdn_team_members(user_id, team_id, role) values(p_user_id, new_team, 'admin');
  return public.hdn_team_context(p_user_id);
end;
$$;

create function public.hdn_invite_member(p_user_id uuid, p_email text, p_role text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target_team uuid; invitation public.hdn_team_invitations%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 731));
  if not public.hdn_user_active(p_user_id) then return jsonb_build_object('error', 'inactive'); end if;
  select team_id into target_team from public.hdn_team_members where user_id = p_user_id;
  if target_team is null then return jsonb_build_object('error', 'forbidden'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_team::text, 732));
  if not exists(select 1 from public.hdn_team_members where user_id = p_user_id and team_id = target_team and role = 'admin') then return jsonb_build_object('error', 'forbidden'); end if;
  if p_role is null or p_role not in ('admin', 'user', 'supervisor') or p_email is null or length(p_email) > 320 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error', 'invalid'); end if;
  if exists(select 1 from public.hdn_team_members m join auth.users u on u.id = m.user_id where lower(btrim(u.email)) = lower(btrim(p_email))) then return jsonb_build_object('error', 'already_member'); end if;
  insert into public.hdn_team_invitations(team_id, email, role, token_hash, created_by, expires_at)
    values(target_team, lower(btrim(p_email)), p_role, p_token_hash, p_user_id, clock_timestamp() + interval '7 days')
    on conflict(team_id, email) do update set role = excluded.role, token_hash = excluded.token_hash,
      created_by = excluded.created_by, expires_at = excluded.expires_at, accepted_at = null
    returning * into invitation;
  return jsonb_build_object('id', invitation.id, 'email', invitation.email, 'role', invitation.role, 'expires_at', invitation.expires_at);
end;
$$;

create function public.hdn_accept_invite(p_user_id uuid, p_email text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare invitation public.hdn_team_invitations%rowtype; account_email text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 731));
  if not public.hdn_user_active(p_user_id) then return jsonb_build_object('error', 'inactive'); end if;
  if exists(select 1 from public.hdn_team_members where user_id = p_user_id) then return jsonb_build_object('error', 'already_member'); end if;
  select * into invitation from public.hdn_team_invitations where token_hash = p_token_hash;
  if not found then return jsonb_build_object('error', 'invalid_invite'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(invitation.team_id::text, 732));
  select * into invitation from public.hdn_team_invitations where token_hash = p_token_hash for update;
  select lower(btrim(email)) into account_email from auth.users where id = p_user_id and email_confirmed_at is not null;
  if not found or account_email is null or p_email is null or account_email <> lower(btrim(p_email)) or invitation.id is null or invitation.email <> account_email or invitation.accepted_at is not null or invitation.expires_at <= clock_timestamp() then return jsonb_build_object('error', 'invalid_invite'); end if;
  insert into public.hdn_team_members(user_id, team_id, role) values(p_user_id, invitation.team_id, invitation.role);
  update public.hdn_team_invitations set accepted_at = clock_timestamp() where id = invitation.id;
  return public.hdn_team_context(p_user_id);
end;
$$;

create function public.hdn_change_role(p_user_id uuid, p_member_id uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target_team uuid; old_role text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 731));
  if not public.hdn_user_active(p_user_id) then return jsonb_build_object('error', 'inactive'); end if;
  select team_id into target_team from public.hdn_team_members where user_id = p_user_id;
  if target_team is null then return jsonb_build_object('error', 'forbidden'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_team::text, 732));
  if not exists(select 1 from public.hdn_team_members where user_id = p_user_id and team_id = target_team and role = 'admin') then return jsonb_build_object('error', 'forbidden'); end if;
  if p_role is null or p_role not in ('admin', 'user', 'supervisor') then return jsonb_build_object('error', 'invalid'); end if;
  select role into old_role from public.hdn_team_members where user_id = p_member_id and team_id = target_team;
  if not found then return jsonb_build_object('error', 'missing_member'); end if;
  if old_role = 'admin' and p_role <> 'admin' and (select count(*) from public.hdn_team_members where team_id = target_team and role = 'admin') = 1 then return jsonb_build_object('error', 'last_admin'); end if;
  update public.hdn_team_members set role = p_role where user_id = p_member_id and team_id = target_team;
  return public.hdn_team_context(p_user_id);
end;
$$;

create function public.hdn_can_read_check(p_user_id uuid, p_check_user_id uuid, p_team_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_check_user_id = p_user_id or exists(
    select 1 from public.hdn_team_members m where m.user_id = p_user_id
      and m.role in ('admin', 'supervisor') and m.team_id = p_team_id
  );
$$;

create function public.hdn_team_history(p_user_id uuid, p_limit integer, p_offset integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  with visible as (
    select c.*, u.email as user_email,
      coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), nullif(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1)) as user_display_name
    from public.hdn_checks c join auth.users u on u.id = c.user_id
    where public.hdn_can_read_check(p_user_id, c.user_id, c.team_id) and public.hdn_user_active(c.user_id)
  ), page as (select * from visible order by created_at desc, id desc limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset))
  select jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(page) || jsonb_build_object('review', null) order by created_at desc, id desc) from page), '[]'::jsonb),
    'total', (select count(*) from visible), 'limit', greatest(1, least(p_limit, 100)), 'offset', greatest(0, p_offset));
$$;

create or replace function public.hdn_usage_stats(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with visible as (select * from public.hdn_checks c where public.hdn_can_read_check(p_user_id, c.user_id, c.team_id) and public.hdn_user_active(c.user_id))
  select jsonb_build_object(
    'total_checks', count(*), 'hot_dogs', count(*) filter(where is_hot_dog),
    'not_hot_dogs', count(*) filter(where not is_hot_dog),
    'cache_hits', count(*) filter(where cached), 'llm_calls', count(*) filter(where not cached),
    'input_tokens', coalesce(sum(input_tokens), 0), 'output_tokens', coalesce(sum(output_tokens), 0),
    'models', (select jsonb_agg(jsonb_build_object('model', model_key, 'checks', checks,
      'cache_hits', cache_hits, 'llm_calls', llm_calls, 'input_tokens', input_tokens, 'output_tokens', output_tokens) order by model_key)
      from (select model_key, count(c.id) as checks, count(c.id) filter(where c.cached) as cache_hits,
        count(c.id) filter(where not c.cached) as llm_calls, coalesce(sum(c.input_tokens), 0) as input_tokens, coalesce(sum(c.output_tokens), 0) as output_tokens
        from (values ('haiku'), ('sonnet')) as models(model_key) left join visible c on c.model = model_key group by model_key) model_totals)
  ) from visible;
$$;

create or replace function public.hdn_claim_check(
  p_user_id uuid, p_image_sha256 text, p_model text, p_model_id text, p_metadata jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry public.hdn_classification_cache%rowtype;
  new_lease uuid := gen_random_uuid();
  check_id uuid;
  issuance_team uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 731));
  if not public.hdn_user_active(p_user_id) then
    return jsonb_build_object('status', 'inactive');
  end if;
  select team_id into issuance_team from public.hdn_team_members where user_id = p_user_id;
  select * into entry from public.hdn_classification_cache
    where user_id = p_user_id and image_sha256 = p_image_sha256 and model_id = p_model_id
    for update;
  if found and entry.status = 'completed' then
    insert into public.hdn_checks(user_id, image_name, file_name, image_sha256,
      model, model_id, is_hot_dog, cached, certificate_id, upload_id, image_key,
      size_bytes, content_type, input_tokens, output_tokens, team_id)
    values(p_user_id, p_metadata->>'image_name', p_metadata->>'file_name', p_image_sha256,
      p_model, p_model_id, entry.is_hot_dog, true, entry.certificate_id,
      (p_metadata->>'upload_id')::uuid, p_metadata->>'image_key',
      (p_metadata->>'size_bytes')::bigint, p_metadata->>'content_type', 0, 0, issuance_team)
    returning id into check_id;
    return jsonb_build_object('status', 'cached', 'certificate_id', entry.certificate_id,
      'is_hot_dog', entry.is_hot_dog, 'check_id', check_id, 'team_id', issuance_team);
  end if;
  if found and entry.status = 'pending' and entry.lease_expires_at > clock_timestamp() then
    return jsonb_build_object('status', 'busy');
  end if;
  insert into public.hdn_classification_cache(user_id, image_sha256, model, model_id,
    status, lease_id, lease_expires_at, lease_team_id)
  values(p_user_id, p_image_sha256, p_model, p_model_id, 'pending', new_lease,
    clock_timestamp() + interval '90 seconds', issuance_team)
  on conflict(user_id, image_sha256, model_id) do update
    set status = 'pending', lease_id = new_lease, lease_team_id = issuance_team,
      lease_expires_at = clock_timestamp() + interval '90 seconds',
      updated_at = clock_timestamp(), certificate_id = null, is_hot_dog = null;
  return jsonb_build_object('status', 'claimed', 'lease_id', new_lease, 'team_id', issuance_team);
end;
$$;

create or replace function public.hdn_complete_check(
  p_user_id uuid, p_image_sha256 text, p_model text, p_model_id text, p_lease_id uuid,
  p_certificate_id uuid, p_is_hot_dog boolean, p_metadata jsonb,
  p_input_tokens bigint, p_output_tokens bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare check_id uuid; issuance_team uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 731));
  if not public.hdn_user_active(p_user_id) then
    return jsonb_build_object('status', 'inactive');
  end if;
  if not exists(select 1 from public.hdn_certificates
    where certificate_id = p_certificate_id and user_id = p_user_id) then
    return jsonb_build_object('status', 'missing_certificate');
  end if;
  select lease_team_id into issuance_team from public.hdn_classification_cache
    where user_id = p_user_id and image_sha256 = p_image_sha256 and model_id = p_model_id
      and status = 'pending' and lease_id = p_lease_id and lease_expires_at > clock_timestamp()
    for update;
  if not found then return jsonb_build_object('status', 'lease_lost'); end if;
  if issuance_team is not null and not exists(select 1 from public.hdn_team_members
    where user_id = p_user_id and team_id = issuance_team) then
    return jsonb_build_object('status', 'membership_changed');
  end if;
  update public.hdn_classification_cache
    set status = 'completed', certificate_id = p_certificate_id,
      is_hot_dog = p_is_hot_dog, lease_id = null, lease_expires_at = null,
      updated_at = clock_timestamp()
    where user_id = p_user_id and image_sha256 = p_image_sha256 and model_id = p_model_id
      and status = 'pending' and lease_id = p_lease_id and lease_expires_at > clock_timestamp();
  if not found then return jsonb_build_object('status', 'lease_lost'); end if;
  insert into public.hdn_checks(user_id, image_name, file_name, image_sha256,
    model, model_id, is_hot_dog, cached, certificate_id, upload_id, image_key,
    size_bytes, content_type, input_tokens, output_tokens, team_id)
  values(p_user_id, p_metadata->>'image_name', p_metadata->>'file_name', p_image_sha256,
    p_model, p_model_id, p_is_hot_dog, false, p_certificate_id,
    (p_metadata->>'upload_id')::uuid, p_metadata->>'image_key',
    (p_metadata->>'size_bytes')::bigint, p_metadata->>'content_type', p_input_tokens, p_output_tokens, issuance_team)
  returning id into check_id;
  return jsonb_build_object('status', 'completed', 'check_id', check_id, 'team_id', issuance_team);
end;
$$;


create or replace function public.hdn_erase_user_records(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare target_team uuid; successor uuid;
begin
  perform public.hdn_begin_user_erasure(p_user_id);
  select team_id into target_team from public.hdn_team_members where user_id = p_user_id;
  if target_team is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_team::text, 732));
    delete from public.hdn_team_invitations where created_by = p_user_id;
    delete from public.hdn_team_members where user_id = p_user_id;
    if not exists(select 1 from public.hdn_team_members where team_id = target_team) then
      delete from public.hdn_teams where id = target_team;
    elsif not exists(select 1 from public.hdn_team_members where team_id = target_team and role = 'admin') then
      select user_id into successor from public.hdn_team_members where team_id = target_team
        order by case role when 'supervisor' then 0 else 1 end, created_at, user_id limit 1;
      update public.hdn_team_members set role = 'admin' where user_id = successor;
    end if;
  end if;
  delete from public.hdn_team_invitations where created_by = p_user_id;
  delete from public.hdn_checks where user_id = p_user_id;
  delete from public.hdn_classification_cache where user_id = p_user_id;
  delete from public.hdn_certificates where user_id = p_user_id;
end;
$$;

revoke all on function public.hdn_team_context(uuid) from public, anon, authenticated;
grant execute on function public.hdn_team_context(uuid) to service_role;
revoke all on function public.hdn_create_team(uuid, text) from public, anon, authenticated;
grant execute on function public.hdn_create_team(uuid, text) to service_role;
revoke all on function public.hdn_invite_member(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.hdn_invite_member(uuid, text, text, text) to service_role;
revoke all on function public.hdn_accept_invite(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hdn_accept_invite(uuid, text, text) to service_role;
revoke all on function public.hdn_change_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.hdn_change_role(uuid, uuid, text) to service_role;
revoke all on function public.hdn_can_read_check(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.hdn_can_read_check(uuid, uuid, uuid) to service_role;
revoke all on function public.hdn_team_history(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.hdn_team_history(uuid, integer, integer) to service_role;
