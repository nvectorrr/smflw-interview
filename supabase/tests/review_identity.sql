-- Requires migration 20261029225000_review_identity.sql. All fixtures roll back.
begin;
do $$
<<review_identity>>
declare
  owner_id uuid := gen_random_uuid(); reviewer_id uuid := gen_random_uuid();
  team_id uuid := gen_random_uuid(); original_cert uuid := gen_random_uuid();
  human_cert uuid := gen_random_uuid(); check_id uuid := gen_random_uuid();
  review_id uuid := gen_random_uuid(); result jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (owner_id,owner_id::text||'@example.invalid','{}'),
    (reviewer_id,reviewer_id::text||'@example.invalid','{"display_name":"  Specific reviewer  ","full_name":"Full reviewer"}');
  insert into public.hdn_teams(id,name) values(team_id,'Identity regression');
  insert into public.hdn_certificates(certificate_id,user_id,json_key,pdf_key) values
    (original_cert,owner_id,'test/'||original_cert||'.json','test/'||original_cert||'.pdf'),
    (human_cert,owner_id,'test/'||human_cert||'.json','test/'||human_cert||'.pdf');
  insert into public.hdn_checks(id,user_id,team_id,image_name,file_name,image_sha256,model,model_id,
    is_hot_dog,cached,certificate_id,upload_id,image_key,size_bytes,content_type)
    values(check_id,owner_id,team_id,'test','test.png',repeat('a',64),'haiku','test-model',true,false,
      original_cert,gen_random_uuid(),'test/image',1,'image/png');
  insert into public.hdn_reviews(id,check_id,team_id,user_id,image_key)
    values(review_id,check_id,team_id,owner_id,'test/review-image');
  result := public.hdn_review_result(review_id);
  assert result ? 'reviewer_id' and result->>'reviewer_id' is null and result->>'reviewer_name' is null,
    'Pending reviews have no reviewer identity';
  update public.hdn_reviews set status='completed', reviewer_id=review_identity.reviewer_id,
    reviewed_at=clock_timestamp(),is_hot_dog=false,certificate_id=human_cert where id=review_id;
  result := public.hdn_review_result(review_id);
  assert result->>'reviewer_id'=reviewer_id::text and result->>'reviewer_name'='Specific reviewer', 'Exact reviewer ID and trimmed display name';
  assert public.hdn_reviews_for_checks(array[check_id])->0=result, 'Authenticated history receives the same identity';
  update auth.users set raw_user_meta_data='{"display_name":" ","full_name":" Full reviewer "}' where id=reviewer_id;
  assert public.hdn_review_result(review_id)->>'reviewer_name'='Full reviewer', 'Full-name fallback';
  update auth.users set raw_user_meta_data='{}' where id=reviewer_id;
  assert public.hdn_review_result(review_id)->>'reviewer_name'=reviewer_id::text||'@example.invalid', 'Full email fallback identifies unnamed reviewer';
  perform public.hdn_begin_user_erasure(reviewer_id);
  result := public.hdn_review_result(review_id);
  assert result->>'reviewer_id' is null and result->>'reviewer_name'='Deleted account', 'Erasure hides identity immediately';
  delete from auth.users where id=reviewer_id;
  result := public.hdn_review_result(review_id);
  assert result->>'reviewer_id' is null and result->>'reviewer_name'='Deleted account', 'Deleted reviewer preserves safe history';
  assert result->>'status'='completed' and result->>'certificate_id'=human_cert::text, 'Erasure retains final determination';
  assert not has_function_privilege('authenticated','public.hdn_review_result(uuid)','EXECUTE'), 'Browser cannot query arbitrary reviewer identity';
  assert not has_function_privilege('anon','public.hdn_review_result(uuid)','EXECUTE'), 'Public cannot query reviewer identity';
  assert has_function_privilege('service_role','public.hdn_review_result(uuid)','EXECUTE'), 'Backend can attach authorized history';
end $$;
select 'Private reviewer identity, name fallbacks, erasure, and grants passed' as result;
rollback;
