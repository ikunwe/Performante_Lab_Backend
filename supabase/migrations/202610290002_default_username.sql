-- Run after 202610290001_profiles.sql.
-- Assign a persistent default on the first account read, including existing users.
begin;
create or replace function public.get_my_account()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_id uuid := auth.uid();
  account_email text;
  chosen text;
  base_name text;
  candidate text;
  suffix text;
  attempt integer := 1;
  password_set boolean;
begin
  if current_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select u.email, coalesce(length(u.encrypted_password), 0) > 0
    into account_email, password_set from auth.users u where u.id = current_id;
  if not found then raise exception 'Account not found' using errcode = '42501'; end if;

  select p.username into chosen from public.profiles p where p.id = current_id;
  if chosen is null then
    base_name := trim(both '_' from regexp_replace(lower(split_part(coalesce(account_email, ''), '@', 1)), '[^a-z0-9_]+', '_', 'g'));
    if length(base_name) < 3 then base_name := 'user_' || base_name; end if;
    base_name := left(base_name, 24);

    loop
      suffix := case when attempt = 1 then '' else '_' || attempt::text end;
      candidate := left(base_name, 24 - length(suffix)) || suffix;
      -- The unique constraints resolve concurrent users and repeated reads safely.
      insert into public.profiles(id, username) values(current_id, candidate)
        on conflict do nothing returning username into chosen;
      if chosen is not null then exit; end if;
      -- Another request may have already saved this user's default/custom name.
      select p.username into chosen from public.profiles p where p.id = current_id;
      if chosen is not null then exit; end if;
      attempt := attempt + 1;
    end loop;
  end if;
  return jsonb_build_object('username', chosen, 'hasPassword', password_set);
end;
$$;
revoke all on function public.get_my_account() from public, anon;
grant execute on function public.get_my_account() to authenticated;
commit;
