-- Run with: npx supabase db query --linked --file supabase/tests/team_removal.sql
-- Synthetic fixtures only; all changes roll back.
begin;
do $$
declare
  admin_id uuid := gen_random_uuid(); member_id uuid := gen_random_uuid();
  supervisor_id uuid := gen_random_uuid(); outsider_id uuid := gen_random_uuid();
  team_id uuid := gen_random_uuid(); other_team uuid := gen_random_uuid();
  cert_id uuid := gen_random_uuid(); check_id uuid := gen_random_uuid(); invite_id uuid := gen_random_uuid();
  result jsonb;
begin
  insert into auth.users(id,email) values
    (admin_id,admin_id::text || '@example.invalid'), (member_id,member_id::text || '@example.invalid'),
    (supervisor_id,supervisor_id::text || '@example.invalid'), (outsider_id,outsider_id::text || '@example.invalid');
  insert into public.hdn_teams(id,name) values(team_id,'Removal test'),(other_team,'Other test');
  insert into public.hdn_team_members(user_id,team_id,role) values
    (admin_id,team_id,'admin'),(member_id,team_id,'user'),(supervisor_id,team_id,'supervisor'),(outsider_id,other_team,'admin');
  assert public.hdn_remove_member(member_id,admin_id)->>'error' = 'forbidden', 'User must not remove a member';
  assert public.hdn_remove_member(supervisor_id,member_id)->>'error' = 'forbidden', 'Supervisor must not remove a member';
  assert public.hdn_remove_member(outsider_id,member_id)->>'error' = 'missing_member', 'Cross-team removal must fail';
  assert public.hdn_remove_member(admin_id,admin_id)->>'error' = 'last_admin', 'Last admin must be retained';
  assert not has_function_privilege('authenticated','public.hdn_remove_member(uuid,uuid)','EXECUTE'), 'No direct authenticated RPC access';
  assert not has_function_privilege('anon','public.hdn_remove_member(uuid,uuid)','EXECUTE'), 'No anonymous RPC access';
  insert into public.hdn_certificates(certificate_id,user_id,json_key,pdf_key) values(cert_id,member_id,'test/record.json','test/certificate.pdf');
  insert into public.hdn_checks(id,user_id,team_id,image_name,file_name,image_sha256,model,model_id,is_hot_dog,cached,certificate_id,upload_id,image_key,size_bytes,content_type)
    values(check_id,member_id,team_id,'test','test.png',repeat('a',64),'haiku','test-model',true,false,cert_id,gen_random_uuid(),'test/image',1,'image/png');
  insert into public.hdn_invite_codes(id,team_id,created_by,role,code_hash,expires_at)
    values(invite_id,team_id,supervisor_id,'user',md5(invite_id::text)||md5(invite_id::text),now()+interval '10 minutes');
  result := public.hdn_remove_member(admin_id,member_id);
  assert result->>'error' is null, 'Admin can remove member';
  assert not exists(select 1 from public.hdn_team_members where user_id=member_id), 'Membership removed';
  assert exists(select 1 from public.hdn_checks where id=check_id), 'History retained';
  assert exists(select 1 from public.hdn_certificates where certificate_id=cert_id), 'Certificate retained';
  assert public.hdn_can_read_check(member_id,member_id,team_id), 'Own history remains accessible';
  assert public.hdn_can_read_check(admin_id,member_id,team_id), 'Admin retains team audit history';
  result := public.hdn_remove_member(admin_id,supervisor_id);
  assert result->>'error' is null, 'Admin can remove supervisor';
  assert not public.hdn_can_read_check(supervisor_id,member_id,team_id), 'Removed reviewer loses team access';
  assert (select expires_at<=clock_timestamp() from public.hdn_invite_codes where id=invite_id), 'Outstanding invite revoked';
  assert public.hdn_remove_member(admin_id,member_id)->>'error' = 'missing_member', 'Repeated removal handled';
end $$;
select 'Membership authorization, last-admin protection, access revocation and history preservation passed' as result;

rollback;
