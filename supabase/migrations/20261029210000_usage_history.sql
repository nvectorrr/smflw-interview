-- Additive storage for authenticated checks. Existing application tables are untouched.
create table public.hdn_erasure_jobs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.hdn_certificates (
  certificate_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  json_key text not null,
  pdf_key text not null,
  created_at timestamptz not null default now()
);
create index hdn_certificates_user_idx on public.hdn_certificates(user_id);

create table public.hdn_classification_cache (
  user_id uuid not null references auth.users(id) on delete cascade,
  image_sha256 text not null check (image_sha256 ~ '^[a-f0-9]{64}$'),
  model text not null check (model in ('haiku', 'sonnet')),
  model_id text not null,
  status text not null check (status in ('pending', 'completed', 'failed')),
  lease_id uuid,
  lease_expires_at timestamptz,
  certificate_id uuid references public.hdn_certificates(certificate_id) on delete cascade,
  is_hot_dog boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id, image_sha256, model_id),
  check (status <> 'completed' or (certificate_id is not null and is_hot_dog is not null))
);

create table public.hdn_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_name text not null,
  file_name text not null,
  image_sha256 text not null check (image_sha256 ~ '^[a-f0-9]{64}$'),
  model text not null check (model in ('haiku', 'sonnet')),
  model_id text not null,
  is_hot_dog boolean not null,
  cached boolean not null,
  created_at timestamptz not null default now(),
  certificate_id uuid not null references public.hdn_certificates(certificate_id) on delete cascade,
  upload_id uuid not null,
  image_key text not null,
  size_bytes bigint not null check (size_bytes > 0),
  content_type text not null,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  check (not cached or (input_tokens = 0 and output_tokens = 0))
);
create index hdn_checks_user_created_idx on public.hdn_checks(user_id, created_at desc, id desc);

alter table public.hdn_erasure_jobs enable row level security;
alter table public.hdn_certificates enable row level security;
alter table public.hdn_classification_cache enable row level security;
alter table public.hdn_checks enable row level security;
revoke all on public.hdn_erasure_jobs, public.hdn_certificates, public.hdn_classification_cache, public.hdn_checks from public, anon, authenticated;
grant select on public.hdn_erasure_jobs, public.hdn_certificates, public.hdn_classification_cache, public.hdn_checks to authenticated;
grant all on public.hdn_erasure_jobs, public.hdn_certificates, public.hdn_classification_cache, public.hdn_checks to service_role;
create policy hdn_erasure_read_own on public.hdn_erasure_jobs for select to authenticated using ((select auth.uid()) = user_id);
create policy hdn_certificate_read_own on public.hdn_certificates for select to authenticated using ((select auth.uid()) = user_id);
create policy hdn_cache_read_own on public.hdn_classification_cache for select to authenticated using ((select auth.uid()) = user_id);
create policy hdn_checks_read_own on public.hdn_checks for select to authenticated using ((select auth.uid()) = user_id);

create function public.hdn_user_active(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users where id = p_user_id)
     and not exists(select 1 from public.hdn_erasure_jobs where user_id = p_user_id);
$$;

create function public.hdn_begin_user_erasure(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 731));
  insert into public.hdn_erasure_jobs(user_id)
    select id from auth.users where id = p_user_id on conflict do nothing;
end;
$$;

create function public.hdn_register_certificate(
  p_user_id uuid, p_certificate_id uuid, p_json_key text, p_pdf_key text, p_created_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 731));
  if not public.hdn_user_active(p_user_id) then return false; end if;
  insert into public.hdn_certificates(certificate_id, user_id, json_key, pdf_key, created_at)
    values(p_certificate_id, p_user_id, p_json_key, p_pdf_key, p_created_at)
    on conflict (certificate_id) do nothing;
  return exists(select 1 from public.hdn_certificates where certificate_id = p_certificate_id
    and user_id = p_user_id and json_key = p_json_key and pdf_key = p_pdf_key);
end;
$$;

create function public.hdn_claim_check(
  p_user_id uuid, p_image_sha256 text, p_model text, p_model_id text, p_metadata jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry public.hdn_classification_cache%rowtype;
  new_lease uuid := gen_random_uuid();
  check_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 731));
  if not public.hdn_user_active(p_user_id) then
    return jsonb_build_object('status', 'inactive');
  end if;
  select * into entry from public.hdn_classification_cache
    where user_id = p_user_id and image_sha256 = p_image_sha256 and model_id = p_model_id
    for update;
  if found and entry.status = 'completed' then
    insert into public.hdn_checks(user_id, image_name, file_name, image_sha256,
      model, model_id, is_hot_dog, cached, certificate_id, upload_id, image_key,
      size_bytes, content_type, input_tokens, output_tokens)
    values(p_user_id, p_metadata->>'image_name', p_metadata->>'file_name', p_image_sha256,
      p_model, p_model_id, entry.is_hot_dog, true, entry.certificate_id,
      (p_metadata->>'upload_id')::uuid, p_metadata->>'image_key',
      (p_metadata->>'size_bytes')::bigint, p_metadata->>'content_type', 0, 0)
    returning id into check_id;
    return jsonb_build_object('status', 'cached', 'certificate_id', entry.certificate_id,
      'is_hot_dog', entry.is_hot_dog, 'check_id', check_id);
  end if;
  if found and entry.status = 'pending' and entry.lease_expires_at > clock_timestamp() then
    return jsonb_build_object('status', 'busy');
  end if;
  insert into public.hdn_classification_cache(user_id, image_sha256, model, model_id,
    status, lease_id, lease_expires_at)
  values(p_user_id, p_image_sha256, p_model, p_model_id, 'pending', new_lease,
    clock_timestamp() + interval '90 seconds')
  on conflict(user_id, image_sha256, model_id) do update
    set status = 'pending', lease_id = new_lease,
      lease_expires_at = clock_timestamp() + interval '90 seconds',
      updated_at = clock_timestamp(), certificate_id = null, is_hot_dog = null;
  return jsonb_build_object('status', 'claimed', 'lease_id', new_lease);
end;
$$;

create function public.hdn_complete_check(
  p_user_id uuid, p_image_sha256 text, p_model text, p_model_id text, p_lease_id uuid,
  p_certificate_id uuid, p_is_hot_dog boolean, p_metadata jsonb,
  p_input_tokens bigint, p_output_tokens bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare check_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 731));
  if not public.hdn_user_active(p_user_id) then
    return jsonb_build_object('status', 'inactive');
  end if;
  if not exists(select 1 from public.hdn_certificates
    where certificate_id = p_certificate_id and user_id = p_user_id) then
    return jsonb_build_object('status', 'missing_certificate');
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
    size_bytes, content_type, input_tokens, output_tokens)
  values(p_user_id, p_metadata->>'image_name', p_metadata->>'file_name', p_image_sha256,
    p_model, p_model_id, p_is_hot_dog, false, p_certificate_id,
    (p_metadata->>'upload_id')::uuid, p_metadata->>'image_key',
    (p_metadata->>'size_bytes')::bigint, p_metadata->>'content_type', p_input_tokens, p_output_tokens)
  returning id into check_id;
  return jsonb_build_object('status', 'completed', 'check_id', check_id);
end;
$$;

create function public.hdn_release_check(
  p_user_id uuid, p_image_sha256 text, p_model_id text, p_lease_id uuid
) returns void language sql security definer set search_path = '' as $$
  update public.hdn_classification_cache
    set status = 'failed', lease_id = null, lease_expires_at = null, updated_at = clock_timestamp()
    where user_id = p_user_id and image_sha256 = p_image_sha256 and model_id = p_model_id
      and status = 'pending' and lease_id = p_lease_id;
$$;

create function public.hdn_usage_stats(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'total_checks', count(*), 'hot_dogs', count(*) filter(where is_hot_dog),
    'not_hot_dogs', count(*) filter(where not is_hot_dog),
    'cache_hits', count(*) filter(where cached), 'llm_calls', count(*) filter(where not cached),
    'input_tokens', coalesce(sum(input_tokens), 0), 'output_tokens', coalesce(sum(output_tokens), 0),
    'models', (select jsonb_agg(jsonb_build_object(
      'model', model_key, 'checks', checks, 'cache_hits', cache_hits,
      'llm_calls', llm_calls, 'input_tokens', input_tokens, 'output_tokens', output_tokens)
      order by model_key) from (
        select model_key, count(c.id) as checks, count(c.id) filter(where c.cached) as cache_hits,
          count(c.id) filter(where not c.cached) as llm_calls,
          coalesce(sum(c.input_tokens), 0) as input_tokens,
          coalesce(sum(c.output_tokens), 0) as output_tokens
        from (values ('haiku'), ('sonnet')) as models(model_key)
        left join public.hdn_checks c on c.model = model_key and c.user_id = p_user_id
        group by model_key
      ) model_totals)
  ) from public.hdn_checks where user_id = p_user_id;
$$;

create function public.hdn_erase_user_records(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.hdn_begin_user_erasure(p_user_id);
  delete from public.hdn_checks where user_id = p_user_id;
  delete from public.hdn_classification_cache where user_id = p_user_id;
  delete from public.hdn_certificates where user_id = p_user_id;
end;
$$;

-- All privileged functions require the backend service role, never a browser JWT.
revoke all on function public.hdn_user_active(uuid) from public, anon, authenticated;
revoke all on function public.hdn_begin_user_erasure(uuid) from public, anon, authenticated;
revoke all on function public.hdn_register_certificate(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.hdn_claim_check(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.hdn_complete_check(uuid, text, text, text, uuid, uuid, boolean, jsonb, bigint, bigint) from public, anon, authenticated;
revoke all on function public.hdn_release_check(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.hdn_usage_stats(uuid) from public, anon, authenticated;
revoke all on function public.hdn_erase_user_records(uuid) from public, anon, authenticated;
grant execute on function public.hdn_user_active(uuid) to service_role;
grant execute on function public.hdn_begin_user_erasure(uuid) to service_role;
grant execute on function public.hdn_register_certificate(uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.hdn_claim_check(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.hdn_complete_check(uuid, text, text, text, uuid, uuid, boolean, jsonb, bigint, bigint) to service_role;
grant execute on function public.hdn_release_check(uuid, text, text, uuid) to service_role;
grant execute on function public.hdn_usage_stats(uuid) to service_role;
grant execute on function public.hdn_erase_user_records(uuid) to service_role;
