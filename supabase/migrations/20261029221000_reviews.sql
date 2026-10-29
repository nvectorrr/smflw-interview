-- Final human determinations remain separate from immutable model checks.
create table public.hdn_reviews (
  id uuid primary key,
  check_id uuid not null unique references public.hdn_checks(id) on delete cascade,
  team_id uuid not null references public.hdn_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  image_key text not null,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  created_at timestamptz not null default now(),
  lease_id uuid,
  lease_expires_at timestamptz,
  reviewer_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  is_hot_dog boolean,
  certificate_id uuid unique references public.hdn_certificates(certificate_id) on delete cascade,
  check (status <> 'completed' or (reviewed_at is not null and is_hot_dog is not null and certificate_id is not null))
);
create index hdn_reviews_queue_idx on public.hdn_reviews(team_id, created_at, id) where status = 'pending';
alter table public.hdn_reviews enable row level security;
revoke all on public.hdn_reviews from public, anon, authenticated;
grant all on public.hdn_reviews to service_role;

create function public.hdn_review_name(p_user_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(trim(raw_user_meta_data->>'display_name'), ''),
    nullif(trim(raw_user_meta_data->>'full_name'), ''), 'Team member')
    from auth.users where id = p_user_id;
$$;

create function public.hdn_review_result(p_review_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'check_id', r.check_id, 'status', r.status,
    'created_at', r.created_at, 'certificate_id', r.certificate_id,
    'is_hot_dog', r.is_hot_dog, 'reviewed_at', r.reviewed_at,
    'reviewer_name', case when r.status = 'completed' then
      coalesce(public.hdn_review_name(r.reviewer_id), 'Authorized team supervisor') end)
  from public.hdn_reviews r where r.id = p_review_id;
$$;

create function public.hdn_escalate_check(p_user_id uuid, p_check_id uuid, p_review_id uuid, p_image_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.hdn_checks%rowtype; r_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 731));
  if not public.hdn_user_active(p_user_id) then return jsonb_build_object('error', 'inactive'); end if;
  select * into c from public.hdn_checks where id = p_check_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  perform 1 from public.hdn_team_members where user_id = p_user_id and team_id = c.team_id for share;
  if not found then return jsonb_build_object('error', 'team_required'); end if;
  if p_image_key <> 'certificates/' || p_user_id::text || '/review-images/' || p_review_id::text then
    return jsonb_build_object('error', 'invalid_image');
  end if;
  insert into public.hdn_reviews(id, check_id, team_id, user_id, image_key)
    values(p_review_id, c.id, c.team_id, p_user_id, p_image_key)
    on conflict(check_id) do nothing;
  select id into r_id from public.hdn_reviews where check_id = c.id;
  return public.hdn_review_result(r_id);
end;
$$;

create function public.hdn_review_queue(p_user_id uuid, p_limit integer, p_offset integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  with permitted as (
    select r.*, c.image_name, c.file_name, c.image_sha256, c.model, c.model_id,
      c.is_hot_dog as original_is_hot_dog, c.certificate_id as original_certificate_id,
      c.size_bytes, c.content_type
    from public.hdn_reviews r join public.hdn_checks c on c.id = r.check_id
    join public.hdn_team_members m on m.team_id = r.team_id and m.user_id = p_user_id
    where m.role in ('admin', 'supervisor') and r.status = 'pending'
      and r.user_id <> p_user_id and public.hdn_user_active(p_user_id)
      and public.hdn_user_active(r.user_id)
  ), page as (
    select * from permitted order by created_at, id limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset)
  ) select jsonb_build_object('items', coalesce((select jsonb_agg(
      (to_jsonb(page) - 'lease_id' - 'lease_expires_at' - 'reviewer_id') ||
      jsonb_build_object('submitter_name', coalesce(public.hdn_review_name(page.user_id), 'Team member'))
      order by created_at, id) from page), '[]'::jsonb),
    'total', (select count(*) from permitted), 'limit', greatest(1, least(p_limit, 100)), 'offset', greatest(0, p_offset));
$$;

create function public.hdn_claim_review(p_user_id uuid, p_review_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.hdn_reviews%rowtype; new_lease uuid := gen_random_uuid();
begin
  select * into r from public.hdn_reviews where id = p_review_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if not public.hdn_user_active(p_user_id) or not public.hdn_user_active(r.user_id) then
    return jsonb_build_object('error', 'inactive'); end if;
  perform 1 from public.hdn_team_members where user_id = p_user_id and team_id = r.team_id
    and role in ('admin', 'supervisor') for share;
  if not found or r.user_id = p_user_id then return jsonb_build_object('error', 'not_found'); end if;
  if r.status = 'completed' then return jsonb_build_object('error', 'completed'); end if;
  if r.lease_expires_at > clock_timestamp() then return jsonb_build_object('error', 'busy'); end if;
  update public.hdn_reviews set lease_id = new_lease, lease_expires_at = clock_timestamp() + interval '90 seconds'
    where id = r.id;
  return to_jsonb(r) || jsonb_build_object('lease_id', new_lease);
end;
$$;

create function public.hdn_complete_review(p_user_id uuid, p_review_id uuid, p_lease_id uuid,
  p_certificate_id uuid, p_is_hot_dog boolean, p_reviewed_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.hdn_reviews%rowtype; member_id uuid;
begin
  -- Match the account-erasure fence; sorted locking avoids cross-review deadlocks.
  for member_id in select id from auth.users where id in (p_user_id,
    (select user_id from public.hdn_reviews where id = p_review_id)) order by id loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(member_id::text, 731));
  end loop;
  select * into r from public.hdn_reviews where id = p_review_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if not public.hdn_user_active(p_user_id) or not public.hdn_user_active(r.user_id) then
    return jsonb_build_object('error', 'inactive'); end if;
  perform 1 from public.hdn_team_members where user_id = p_user_id and team_id = r.team_id
    and role in ('admin', 'supervisor') for share;
  if not found or p_user_id = r.user_id then return jsonb_build_object('error', 'not_found'); end if;
  if r.status <> 'pending' or r.lease_id is distinct from p_lease_id or r.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('error', 'lease_lost'); end if;
  insert into public.hdn_certificates(certificate_id, user_id, json_key, pdf_key, created_at)
    values(p_certificate_id, r.user_id,
      'certificates/' || r.user_id::text || '/' || p_certificate_id::text || '.json',
      'certificates/' || r.user_id::text || '/' || p_certificate_id::text || '.pdf', p_reviewed_at);
  update public.hdn_reviews set status = 'completed', reviewer_id = p_user_id,
    reviewed_at = p_reviewed_at, is_hot_dog = p_is_hot_dog, certificate_id = p_certificate_id,
    lease_id = null, lease_expires_at = null where id = r.id;
  return public.hdn_review_result(r.id);
end;
$$;

create function public.hdn_release_review(p_review_id uuid, p_lease_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.hdn_reviews set lease_id = null, lease_expires_at = null
    where id = p_review_id and status = 'pending' and lease_id = p_lease_id;
$$;

revoke all on function public.hdn_review_name(uuid) from public, anon, authenticated;
revoke all on function public.hdn_review_result(uuid) from public, anon, authenticated;
revoke all on function public.hdn_escalate_check(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.hdn_review_queue(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.hdn_claim_review(uuid, uuid) from public, anon, authenticated;
revoke all on function public.hdn_complete_review(uuid, uuid, uuid, uuid, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.hdn_release_review(uuid, uuid) from public, anon, authenticated;
grant execute on function public.hdn_review_name(uuid), public.hdn_review_result(uuid),
  public.hdn_escalate_check(uuid, uuid, uuid, text), public.hdn_review_queue(uuid, integer, integer),
  public.hdn_claim_review(uuid, uuid), public.hdn_complete_review(uuid, uuid, uuid, uuid, boolean, timestamptz),
  public.hdn_release_review(uuid, uuid) to service_role;

create function public.hdn_reviews_for_checks(p_check_ids uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.hdn_review_result(id)), '[]'::jsonb)
    from public.hdn_reviews where check_id = any(p_check_ids);
$$;
revoke all on function public.hdn_reviews_for_checks(uuid[]) from public, anon, authenticated;
grant execute on function public.hdn_reviews_for_checks(uuid[]) to service_role;
