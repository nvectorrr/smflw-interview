-- Run with: npx supabase db query --linked --file supabase/tests/review_queue.sql
-- Only randomly identified synthetic records are changed; everything rolls back.
begin;
do $$
declare
  admin_id uuid := gen_random_uuid(); submitter_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid(); team_id uuid := gen_random_uuid();
  other_team_id uuid := gen_random_uuid();
  new_admin uuid := gen_random_uuid(); new_supervisor uuid := gen_random_uuid();
  promoted_admin uuid := gen_random_uuid(); promoted_supervisor uuid := gen_random_uuid();
  actors uuid[]; reviews uuid[] := '{}'; actor uuid; owner_id uuid;
  cert_id uuid; check_id uuid; review_id uuid; lease uuid; old_lease uuid;
  code_hash text; role_name text; result jsonb; competitor jsonb; i integer;
begin
  actors := array[new_admin, new_supervisor, promoted_admin, promoted_supervisor];
  foreach actor in array array[admin_id,submitter_id,outsider_id] || actors loop
    insert into auth.users(id,email) values(actor,actor::text || '@example.invalid');
  end loop;
  insert into public.hdn_teams(id,name) values(team_id,'Shared queue regression'),(other_team_id,'Other regression');
  insert into public.hdn_team_members(user_id,team_id,role) values
    (admin_id,team_id,'admin'),(submitter_id,team_id,'user'),(outsider_id,other_team_id,'admin'),
    (promoted_admin,team_id,'user'),(promoted_supervisor,team_id,'user');

  -- Reviews predate the invitation acceptance and role promotion.
  for i in 1..7 loop
    owner_id := case when i=6 then admin_id when i=7 then outsider_id else submitter_id end;
    cert_id := gen_random_uuid(); check_id := gen_random_uuid(); review_id := gen_random_uuid();
    reviews := array_append(reviews,review_id);
    insert into public.hdn_certificates(certificate_id,user_id,json_key,pdf_key)
      values(cert_id,owner_id,'test/'||cert_id||'.json','test/'||cert_id||'.pdf');
    insert into public.hdn_checks(id,user_id,team_id,image_name,file_name,image_sha256,model,model_id,
      is_hot_dog,cached,certificate_id,upload_id,image_key,size_bytes,content_type)
      values(check_id,owner_id,case when i=7 then other_team_id else team_id end,
        'test','test.png',repeat('a',64),'haiku','test-model',true,false,cert_id,gen_random_uuid(),'test/image',1,'image/png');
    insert into public.hdn_reviews(id,check_id,team_id,user_id,image_key)
      values(review_id,check_id,case when i=7 then other_team_id else team_id end,owner_id,
        'certificates/'||owner_id||'/review-images/'||review_id);
  end loop;

  assert (public.hdn_review_queue(admin_id,100,0)->>'total')::int=5, 'Own and other-team reviews excluded';
  foreach actor in array array[submitter_id,outsider_id] || actors loop
    assert (public.hdn_review_queue(actor,100,0)->>'total')::int=0, 'Non-members, users, outsiders cannot review';
    assert public.hdn_claim_review(actor,reviews[1])->>'error'='not_found', 'Queue exclusion also enforced on claim';
  end loop;
  assert public.hdn_claim_review(admin_id,reviews[6])->>'error'='not_found', 'Admins cannot decide their own review';

  for i in 1..2 loop
    actor := actors[i]; role_name := case when i=1 then 'admin' else 'supervisor' end;
    code_hash := md5(actor::text)||md5(actor::text);
    result := public.hdn_create_invite_code(admin_id,role_name,code_hash);
    assert result->>'error' is null, 'Invitation created';
    result := public.hdn_accept_invite_code(actor,code_hash);
    assert result->'team'->>'role'=role_name, 'Invited reviewer joined with intended role';
  end loop;
  assert public.hdn_change_role(admin_id,promoted_admin,'admin')->>'error' is null, 'Promoted admin';
  assert public.hdn_change_role(admin_id,promoted_supervisor,'supervisor')->>'error' is null, 'Promoted supervisor';

  foreach actor in array actors loop
    result := public.hdn_review_queue(actor,100,0);
    assert (result->>'total')::int=6 and jsonb_array_length(result->'items')=6,
      'Every new/promoted admin or supervisor sees all pre-existing team reviews';
    assert not exists(select 1 from jsonb_array_elements(result->'items') item where item->>'id'=reviews[7]::text),
      'Other-team review never enters shared queue';
  end loop;

  -- All four reviewer entry paths can decide; competing and stale leases cannot win.
  for i in 1..4 loop
    actor := actors[i]; review_id := reviews[i]; cert_id := gen_random_uuid();
    result := public.hdn_claim_review(actor,review_id);
    lease := (result->>'lease_id')::uuid;
    assert lease is not null, 'Eligible reviewer claims pending review';
    competitor := public.hdn_claim_review(admin_id,review_id);
    assert competitor->>'error'='busy', 'Second reviewer cannot claim an active lease';
    result := public.hdn_complete_review(admin_id,review_id,gen_random_uuid(),gen_random_uuid(),false,clock_timestamp());
    assert result->>'error'='lease_lost', 'A competing decision without the lease is rejected';
    result := public.hdn_complete_review(actor,review_id,lease,cert_id,false,clock_timestamp());
    assert result->>'status'='completed', 'New/promoted reviewer can complete the review';
    assert (select reviewer_id=actor and certificate_id=cert_id from public.hdn_reviews where id=review_id),
      'The actual winner and certificate are recorded';
    assert public.hdn_claim_review(admin_id,review_id)->>'error'='completed', 'Completed review cannot be claimed again';
    assert public.hdn_complete_review(admin_id,review_id,lease,gen_random_uuid(),true,clock_timestamp())->>'error'='lease_lost',
      'A competing final verdict cannot overwrite the winner';
  end loop;

  review_id := reviews[5];
  old_lease := (public.hdn_claim_review(new_admin,review_id)->>'lease_id')::uuid;
  update public.hdn_reviews set lease_expires_at=clock_timestamp()-interval '1 second' where id=review_id;
  lease := (public.hdn_claim_review(new_supervisor,review_id)->>'lease_id')::uuid;
  assert lease is not null and lease<>old_lease, 'Expired work can be reclaimed';
  assert public.hdn_complete_review(new_admin,review_id,old_lease,gen_random_uuid(),true,clock_timestamp())->>'error'='lease_lost',
    'Expired lease cannot publish a late verdict';
  assert public.hdn_complete_review(new_supervisor,review_id,lease,gen_random_uuid(),false,clock_timestamp())->>'status'='completed',
    'Replacement lease can complete';
  assert (public.hdn_review_queue(new_admin,100,0)->>'total')::int=1, 'Completed reviews leave the shared queue';
  assert not has_function_privilege('authenticated','public.hdn_review_queue(uuid,integer,integer)','EXECUTE'), 'Queue is backend-only';
  assert not has_function_privilege('anon','public.hdn_review_result(uuid)','EXECUTE'), 'Review identity is private';
end $$;
select 'Shared queue, join/promotion eligibility, exclusions, and decision lease checks passed' as result;
rollback;
