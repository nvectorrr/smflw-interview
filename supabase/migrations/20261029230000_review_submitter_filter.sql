-- Filter within the authorized queue so totals and pagination describe the selected submitter.
create function public.hdn_review_queue(p_user_id uuid, p_limit integer, p_offset integer, p_submitter_id uuid) returns jsonb
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
      and (p_submitter_id is null or r.user_id = p_submitter_id)
  ), page as (
    select * from permitted order by created_at, id limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset)
  ) select jsonb_build_object('items', coalesce((select jsonb_agg(
      (to_jsonb(page) - 'lease_id' - 'lease_expires_at' - 'reviewer_id') ||
      jsonb_build_object('submitter_name', coalesce(public.hdn_review_name(page.user_id), 'Team member'))
      order by created_at, id) from page), '[]'::jsonb),
    'total', (select count(*) from permitted), 'limit', greatest(1, least(p_limit, 100)), 'offset', greatest(0, p_offset));
$$;

-- Keep deployed callers working without overload ambiguity from default arguments.
create or replace function public.hdn_review_queue(p_user_id uuid, p_limit integer, p_offset integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.hdn_review_queue(p_user_id, p_limit, p_offset, null::uuid);
$$;

revoke all on function public.hdn_review_queue(uuid, integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.hdn_review_queue(uuid, integer, integer, uuid) to service_role;
