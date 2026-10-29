-- Serialize with role changes, invitation acceptance and account cleanup.
create function public.hdn_remove_member(p_user_id uuid, p_member_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target_team uuid; old_role text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 731));
  if not public.hdn_user_active(p_user_id) then return jsonb_build_object('error', 'inactive'); end if;
  select team_id into target_team from public.hdn_team_members where user_id = p_user_id;
  if target_team is null then return jsonb_build_object('error', 'forbidden'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_team::text, 732));
  if not exists(select 1 from public.hdn_team_members where user_id = p_user_id and team_id = target_team and role = 'admin') then return jsonb_build_object('error', 'forbidden'); end if;
  select role into old_role from public.hdn_team_members where user_id = p_member_id and team_id = target_team;
  if not found then return jsonb_build_object('error', 'missing_member'); end if;
  if old_role = 'admin' and (select count(*) from public.hdn_team_members where team_id = target_team and role = 'admin') <= 1 then return jsonb_build_object('error', 'last_admin'); end if;
  delete from public.hdn_team_members where user_id = p_member_id and team_id = target_team;
  -- A removed administrator cannot use an outstanding code to restore access.
  update public.hdn_invite_codes set expires_at = clock_timestamp()
    where team_id = target_team and created_by = p_member_id and accepted_at is null;
  update public.hdn_team_invitations set expires_at = clock_timestamp()
    where team_id = target_team and created_by = p_member_id and accepted_at is null;
  -- Historical checks and review evidence remain part of the team's audit record.
  return public.hdn_team_context(p_user_id);
end;
$$;
revoke all on function public.hdn_remove_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.hdn_remove_member(uuid, uuid) to service_role;
