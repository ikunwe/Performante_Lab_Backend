-- Run after 001. Supersedes the email-based default in 002.
begin;
alter table public.profiles drop constraint if exists profiles_username_check;
alter table public.profiles add constraint profiles_username_check
  check (char_length(username) between 1 and 64 and username = trim(username) and username !~ '[[:cntrl:]@]');
create unique index if not exists profiles_username_lower_unique on public.profiles(lower(username));

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
begin
  if current_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select coalesce(length(u.encrypted_password), 0) > 0 into password_set
    from auth.users u where u.id = current_id;
  if not found then raise exception 'Account not found' using errcode = '42501'; end if;
  select p.username into chosen from public.profiles p where p.id = current_id;
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
      insert into public.profiles(id, username) values(current_id, candidate)
        on conflict do nothing returning username into chosen;
      if chosen is not null then exit; end if;
      select p.username into chosen from public.profiles p where p.id = current_id;
      if chosen is not null then exit; end if;
      attempt := attempt + 1;
    end loop;
  end if;
  return jsonb_build_object('username', chosen, 'hasPassword', password_set);
end;
$$;

create or replace function public.set_my_username(new_username text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare normalized text := trim(new_username);
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if normalized is null or char_length(normalized) not between 1 and 64 or normalized ~ '[[:cntrl:]@]' then
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

-- Backend-only lookup: no public email or username directory.
create or replace function public.find_username_account(input_username text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.profiles where lower(username) = lower(trim(input_username));
$$;
revoke all on function public.find_username_account(text) from public, anon, authenticated;
grant execute on function public.find_username_account(text) to service_role;
commit;
