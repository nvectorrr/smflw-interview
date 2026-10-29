-- Remove invitations addressed to an erased account before deleting its Auth identity.
create or replace function public.hdn_erase_user_records(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare target_team uuid; successor uuid;
begin
  perform public.hdn_begin_user_erasure(p_user_id);
  select team_id into target_team from public.hdn_team_members where user_id = p_user_id;
  if target_team is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_team::text, 732));
    delete from public.hdn_team_invitations
    where created_by = p_user_id
       or email = (select lower(btrim(email)) from auth.users where id = p_user_id);
    delete from public.hdn_team_members where user_id = p_user_id;
    if not exists(select 1 from public.hdn_team_members where team_id = target_team) then
      delete from public.hdn_teams where id = target_team;
    elsif not exists(select 1 from public.hdn_team_members where team_id = target_team and role = 'admin') then
      select user_id into successor from public.hdn_team_members where team_id = target_team
        order by case role when 'supervisor' then 0 else 1 end, created_at, user_id limit 1;
      update public.hdn_team_members set role = 'admin' where user_id = successor;
    end if;
  end if;
  delete from public.hdn_team_invitations
    where created_by = p_user_id
       or email = (select lower(btrim(email)) from auth.users where id = p_user_id);
  delete from public.hdn_checks where user_id = p_user_id;
  delete from public.hdn_classification_cache where user_id = p_user_id;
  delete from public.hdn_certificates where user_id = p_user_id;
end;
$$;
