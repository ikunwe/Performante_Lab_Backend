-- Run once in the Supabase SQL Editor for performante_lab.
-- Admin RBAC, Profiles extension, Part Requests, and Builds.
begin;

-- 1. Extend public.profiles with role and status (default User & Active)
alter table public.profiles
  add column if not exists role text not null default 'User' check (role in ('User', 'Admin', 'SuperAdmin')),
  add column if not exists status text not null default 'Active' check (status in ('Active', 'InActive'));

-- Ensure all existing profiles are set to role 'User' and status 'Active'
update public.profiles
  set role = 'User',
      status = 'Active';

-- Helper to check if a user is Admin or SuperAdmin without triggering RLS recursion
create or replace function public.is_admin_or_superadmin(check_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = check_user_id and role in ('Admin', 'SuperAdmin')
  );
$$;

revoke all on function public.is_admin_or_superadmin(uuid) from public, anon;
grant execute on function public.is_admin_or_superadmin(uuid) to authenticated, service_role;

-- RLS Policy: Admins and SuperAdmins can view all profiles
drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles" on public.profiles
  for select to authenticated
  using (public.is_admin_or_superadmin(auth.uid()));

-- 2. Update public.get_my_account() to return role and status
create or replace function public.get_my_account()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_id uuid := auth.uid();
  chosen text;
  base_name text;
  candidate text;
  suffix text;
  attempt integer := 1;
  password_set boolean;
  user_role text;
  user_status text;
begin
  if current_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select coalesce(length(u.encrypted_password), 0) > 0 into password_set
    from auth.users u where u.id = current_id;
  if not found then raise exception 'Account not found' using errcode = '42501'; end if;

  select p.username, p.role, p.status into chosen, user_role, user_status
    from public.profiles p where p.id = current_id;

  if chosen is null then
    select coalesce(nullif(trim(i.identity_data->>'full_name'), ''), nullif(trim(i.identity_data->>'name'), ''))
      into base_name from auth.identities i where i.user_id = current_id and i.provider = 'google' limit 1;
    if base_name is null then
      select coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), nullif(trim(u.raw_user_meta_data->>'name'), ''), 'Driver')
        into base_name from auth.users u where u.id = current_id;
    end if;
    -- Preserve Google's spelling, spaces and Thai names, except reserved/control characters.
    base_name := left(trim(regexp_replace(base_name, '[[:cntrl:]@]', '_', 'g')), 64);
    if base_name = '' then base_name := 'Driver'; end if;
    loop
      suffix := case when attempt = 1 then '' else '_' || attempt::text end;
      candidate := rtrim(left(base_name, 64 - length(suffix))) || suffix;
      insert into public.profiles(id, username, role, status)
        values(current_id, candidate, 'User', 'Active')
        on conflict do nothing returning username, role, status into chosen, user_role, user_status;
      if chosen is not null then exit; end if;
      select p.username, p.role, p.status into chosen, user_role, user_status
        from public.profiles p where p.id = current_id;
      if chosen is not null then exit; end if;
      attempt := attempt + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'username', chosen,
    'hasPassword', password_set,
    'role', coalesce(user_role, 'User'),
    'status', coalesce(user_status, 'Active')
  );
end;
$$;

revoke all on function public.get_my_account() from public, anon;
grant execute on function public.get_my_account() to authenticated;

-- 3. Helper function for backend to query role and status
create or replace function public.get_user_role_and_status(target_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'role', coalesce(p.role, 'User'),
    'status', coalesce(p.status, 'Active')
  ) into result
  from public.profiles p
  where p.id = target_user_id;

  if result is null then
    result := jsonb_build_object('role', 'User', 'status', 'Active');
  end if;

  return result;
end;
$$;

revoke all on function public.get_user_role_and_status(uuid) from public, anon;
grant execute on function public.get_user_role_and_status(uuid) to service_role, authenticated;

-- 4. Create table public.part_requests
create table if not exists public.part_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  car_model text not null check (char_length(car_model) between 1 and 100),
  tag text not null check (char_length(tag) between 1 and 50),
  category text not null,
  description text not null,
  status text not null default 'Pending' check (status in ('Pending', 'Accepted', 'Rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.part_requests enable row level security;
revoke all on public.part_requests from anon, authenticated;
grant select, insert, update on public.part_requests to authenticated;
grant all on public.part_requests to service_role;

drop policy if exists "Users and Admins can view part requests" on public.part_requests;
create policy "Users and Admins can view part requests" on public.part_requests
  for select to authenticated
  using ((select auth.uid()) = user_id or public.is_admin_or_superadmin(auth.uid()));

drop policy if exists "Users can insert own part requests" on public.part_requests;
create policy "Users can insert own part requests" on public.part_requests
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Admins can update part requests" on public.part_requests;
create policy "Admins can update part requests" on public.part_requests
  for update to authenticated
  using (public.is_admin_or_superadmin(auth.uid()))
  with check (public.is_admin_or_superadmin(auth.uid()));

-- 5. Create table public.builds
create table if not exists public.builds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  car_name text not null,
  tag text not null,
  image_url text not null,
  parts text[] not null default '{}',
  budget numeric not null default 0 check (budget >= 0),
  category text not null default 'Street' check (category in ('Street', 'Track', 'Show')),
  likes integer not null default 0 check (likes >= 0),
  is_public boolean not null default true,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.builds enable row level security;
revoke all on public.builds from anon, authenticated;
grant select on public.builds to anon, authenticated;
grant insert, update, delete on public.builds to authenticated;
grant all on public.builds to service_role;

drop policy if exists "View builds" on public.builds;
create policy "View builds" on public.builds
  for select using (
    (is_public = true and is_deleted = false)
    or ((select auth.uid()) = user_id)
    or public.is_admin_or_superadmin(auth.uid())
  );

drop policy if exists "Users can insert own builds" on public.builds;
create policy "Users can insert own builds" on public.builds
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owners and Admins can update builds" on public.builds;
create policy "Owners and Admins can update builds" on public.builds
  for update to authenticated
  using (
    (select auth.uid()) = user_id or public.is_admin_or_superadmin(auth.uid())
  )
  with check (
    (select auth.uid()) = user_id or public.is_admin_or_superadmin(auth.uid())
  );

drop policy if exists "Owners and Admins can delete builds" on public.builds;
create policy "Owners and Admins can delete builds" on public.builds
  for delete to authenticated
  using (
    (select auth.uid()) = user_id or public.is_admin_or_superadmin(auth.uid())
  );

commit;
