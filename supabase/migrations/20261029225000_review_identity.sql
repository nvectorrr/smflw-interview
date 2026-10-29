-- Reviewer identity is available only through authenticated history/review APIs.
-- Public immutable certificate evidence continues to use a generic reviewer label.
create or replace function public.hdn_review_result(p_review_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'check_id', r.check_id, 'status', r.status,
    'created_at', r.created_at, 'certificate_id', r.certificate_id,
    'is_hot_dog', r.is_hot_dog, 'reviewed_at', r.reviewed_at,
    'reviewer_id', case when r.status = 'completed' and public.hdn_user_active(r.reviewer_id)
      then r.reviewer_id end,
    'reviewer_name', case when r.status = 'completed' then
      case when not public.hdn_user_active(r.reviewer_id) then 'Deleted account'
        else coalesce(nullif(btrim(u.raw_user_meta_data->>'display_name'), ''),
          nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
          nullif(btrim(u.email), ''), 'Team member') end end)
  from public.hdn_reviews r left join auth.users u on u.id = r.reviewer_id
  where r.id = p_review_id;
$$;

revoke all on function public.hdn_review_result(uuid) from public, anon, authenticated;
grant execute on function public.hdn_review_result(uuid) to service_role;
