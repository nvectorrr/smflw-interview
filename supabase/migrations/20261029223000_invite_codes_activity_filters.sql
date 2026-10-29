-- Replace long email invitations with single-use, short-lived bearer codes.
update public.hdn_team_invitations set expires_at = now() where accepted_at is null;
revoke execute on function public.hdn_invite_member(uuid,text,text,text) from service_role;
revoke execute on function public.hdn_accept_invite(uuid,text,text) from service_role;
create table public.hdn_invite_codes (
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null references public.hdn_teams(id) on delete cascade,
 created_by uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('admin','supervisor','user')),
 code_hash text not null unique check(code_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null,
 accepted_at timestamptz
);
create table public.hdn_invite_attempts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 started_at timestamptz not null,
 attempts integer not null
);
alter table public.hdn_invite_codes enable row level security;
alter table public.hdn_invite_attempts enable row level security;
revoke all on public.hdn_invite_codes,public.hdn_invite_attempts from public,anon,authenticated;
grant all on public.hdn_invite_codes,public.hdn_invite_attempts to service_role;
create or replace function public.hdn_team_context(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare member public.hdn_team_members%rowtype;
begin
  select * into member from public.hdn_team_members where user_id = p_user_id;
  if not found then return jsonb_build_object('team', null, 'members', '[]'::jsonb, 'invitations', '[]'::jsonb); end if;
  return jsonb_build_object(
    'team', (select jsonb_build_object('id', id, 'name', name, 'role', member.role) from public.hdn_teams where id = member.team_id),
    'members', case when member.role in ('admin','supervisor') then (
      select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'user_id', m.user_id, 'email', u.email,
        'display_name', coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), nullif(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1)),
        'role', m.role) order by m.created_at, m.user_id), '[]'::jsonb)
      from public.hdn_team_members m join auth.users u on u.id = m.user_id where m.team_id = member.team_id
    ) else '[]'::jsonb end,
    'invitations', case when member.role = 'admin' then (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'role', role, 'expires_at', expires_at) order by expires_at), '[]'::jsonb)
      from public.hdn_invite_codes where team_id = member.team_id and accepted_at is null and expires_at > now()
    ) else '[]'::jsonb end
  );
end;
$$;


create function public.hdn_create_invite_code(p_user_id uuid,p_role text,p_code_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target_team uuid; invitation public.hdn_invite_codes%rowtype;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,731));
 if not public.hdn_user_active(p_user_id) then return jsonb_build_object('error','inactive'); end if;
 select team_id into target_team from public.hdn_team_members where user_id=p_user_id;
 if target_team is null then return jsonb_build_object('error','forbidden'); end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_team::text,732));
 if not exists(select 1 from public.hdn_team_members where user_id=p_user_id and team_id=target_team and role='admin') then return jsonb_build_object('error','forbidden'); end if;
 if p_role is null or p_role not in ('admin','supervisor','user') then return jsonb_build_object('error','invalid'); end if;
 insert into public.hdn_invite_codes(team_id,created_by,role,code_hash,expires_at)
 values(target_team,p_user_id,p_role,p_code_hash,clock_timestamp()+interval '10 minutes')
 on conflict(code_hash) do nothing returning * into invitation;
 if not found then return jsonb_build_object('error','collision'); end if;
 return jsonb_build_object('id',invitation.id,'role',invitation.role,'expires_at',invitation.expires_at);
end; $$;
create function public.hdn_accept_invite_code(p_user_id uuid,p_code_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invitation public.hdn_invite_codes%rowtype; attempt public.hdn_invite_attempts%rowtype;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,731));
 if not public.hdn_user_active(p_user_id) then return jsonb_build_object('error','inactive'); end if;
 if exists(select 1 from public.hdn_team_members where user_id=p_user_id) then return jsonb_build_object('error','already_member'); end if;
 insert into public.hdn_invite_attempts values(p_user_id,clock_timestamp(),1)
 on conflict(user_id) do update set
 attempts=case when hdn_invite_attempts.started_at < clock_timestamp()-interval '10 minutes' then 1 else hdn_invite_attempts.attempts+1 end,
 started_at=case when hdn_invite_attempts.started_at < clock_timestamp()-interval '10 minutes' then clock_timestamp() else hdn_invite_attempts.started_at end
 returning * into attempt;
 if attempt.attempts>10 then return jsonb_build_object('error','rate_limited'); end if;
 select * into invitation from public.hdn_invite_codes where code_hash=p_code_hash;
 if not found then return jsonb_build_object('error','invalid_invite'); end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(invitation.team_id::text,732));
 select * into invitation from public.hdn_invite_codes where code_hash=p_code_hash for update;
 if not found or not public.hdn_user_active(invitation.created_by) or invitation.accepted_at is not null or invitation.expires_at<=clock_timestamp() then return jsonb_build_object('error','invalid_invite'); end if;
 insert into public.hdn_team_members(user_id,team_id,role) values(p_user_id,invitation.team_id,invitation.role);
 update public.hdn_invite_codes set accepted_at=clock_timestamp() where id=invitation.id;
 return public.hdn_team_context(p_user_id);
end; $$;
revoke all on function public.hdn_create_invite_code(uuid,text,text), public.hdn_accept_invite_code(uuid,text) from public,anon,authenticated;
grant execute on function public.hdn_create_invite_code(uuid,text,text), public.hdn_accept_invite_code(uuid,text) to service_role;

create function public.hdn_filtered_checks(p_user_id uuid,p_filter_user uuid,p_result boolean,p_verification text,p_model text)
returns setof public.hdn_checks language sql stable security definer set search_path='' as $$
 select c.* from public.hdn_checks c left join public.hdn_reviews r on r.check_id=c.id
 where public.hdn_user_active(p_user_id) and public.hdn_user_active(c.user_id)
 and public.hdn_can_read_check(p_user_id,c.user_id,c.team_id)
 and (p_filter_user is null or c.user_id=p_filter_user)
 and (p_result is null or coalesce(r.is_hot_dog,c.is_hot_dog)=p_result)
 and (p_model is null or c.model=p_model)
 and (p_verification='all' or (p_verification='pending' and r.status='pending')
 or (p_verification='verified' and r.status='completed') or (p_verification='unreviewed' and r.id is null));
$$;
create function public.hdn_filtered_history(p_user_id uuid, p_limit integer, p_offset integer, p_filter_user uuid, p_result boolean, p_verification text, p_model text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with visible as (
    select c.*, u.email as user_email,
      coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), nullif(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1)) as user_display_name
    from public.hdn_filtered_checks(p_user_id,p_filter_user,p_result,p_verification,p_model) c join auth.users u on u.id = c.user_id
    where public.hdn_can_read_check(p_user_id, c.user_id, c.team_id) and public.hdn_user_active(c.user_id)
  ), page as (select * from visible order by created_at desc, id desc limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset))
  select jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(page) || jsonb_build_object('review', null) order by created_at desc, id desc) from page), '[]'::jsonb),
    'total', (select count(*) from visible), 'limit', greatest(1, least(p_limit, 100)), 'offset', greatest(0, p_offset));
$$;

create function public.hdn_filtered_stats(p_user_id uuid, p_filter_user uuid, p_result boolean, p_verification text, p_model text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with visible as (select c.id,c.model,c.cached,c.input_tokens,c.output_tokens,
    coalesce(r.is_hot_dog,c.is_hot_dog) as is_hot_dog
    from public.hdn_filtered_checks(p_user_id,p_filter_user,p_result,p_verification,p_model) c
    left join public.hdn_reviews r on r.check_id=c.id)
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


revoke all on function public.hdn_filtered_checks(uuid,uuid,boolean,text,text), public.hdn_filtered_history(uuid,integer,integer,uuid,boolean,text,text), public.hdn_filtered_stats(uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.hdn_filtered_checks(uuid,uuid,boolean,text,text), public.hdn_filtered_history(uuid,integer,integer,uuid,boolean,text,text), public.hdn_filtered_stats(uuid,uuid,boolean,text,text) to service_role;
