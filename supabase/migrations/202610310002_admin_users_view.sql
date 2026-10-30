-- Admin Users List helper function
begin;

create or replace function public.admin_list_users()
returns table (
  id uuid,
  username text,
  email varchar(255),
  role text,
  status text,
  joined_at timestamptz
) language plpgsql security definer set search_path = '' as $$
begin
  -- ตรวจสอบว่าผู้เรียกต้องเป็น Admin หรือ SuperAdmin
  if not public.is_admin_or_superadmin(auth.uid()) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return query
    select
      p.id,
      p.username,
      u.email::varchar(255),
      coalesce(p.role, 'User') as role,
      coalesce(p.status, 'Active') as status,
      coalesce(u.created_at, p.updated_at) as joined_at
    from public.profiles p
    left join auth.users u on u.id = p.id
    order by u.created_at desc nulls last;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated, service_role;

commit;
