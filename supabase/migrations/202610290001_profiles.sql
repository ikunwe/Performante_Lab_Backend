-- Run once in the Supabase SQL Editor for performante_lab.
begin;
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
drop policy if exists "Read own profile" on public.profiles;
create policy "Read own profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);

-- Only exposes the current user's boolean password status, never the hash.
create or replace function public.get_my_account()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select jsonb_build_object('username', p.username, 'hasPassword', coalesce(length(u.encrypted_password), 0) > 0)
    into result from auth.users u left join public.profiles p on p.id = u.id where u.id = auth.uid();
  return result;
end;
$$;

create or replace function public.set_my_username(new_username text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare normalized text := lower(trim(new_username));
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if normalized is null or normalized !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Invalid username' using errcode = '22023';
  end if;
  insert into public.profiles(id, username) values(auth.uid(), normalized)
    on conflict (id) do update set username = excluded.username, updated_at = now();
  return public.get_my_account();
end;
$$;
revoke all on function public.get_my_account() from public, anon;
revoke all on function public.set_my_username(text) from public, anon;
grant execute on function public.get_my_account() to authenticated;
grant execute on function public.set_my_username(text) to authenticated;
commit;
