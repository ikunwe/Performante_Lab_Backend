begin;

-- Serialize setup with Like writes so the initial reconciliation cannot miss a Like.
lock table public.build_likes, public.builds in share row exclusive mode;
drop trigger if exists guard_build_like_count on public.builds;

-- Replace legacy/manual counters with the number of real account Likes.
update public.builds b
set likes = (select count(*)::integer from public.build_likes l where l.build_id = b.id);

create or replace function public.adjust_build_like_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.builds set likes = likes + 1 where id = new.build_id;
    return new;
  else
    update public.builds set likes = greatest(likes - 1, 0) where id = old.build_id;
    return old;
  end if;
end;
$$;
revoke all on function public.adjust_build_like_count() from public, anon, authenticated;

drop trigger if exists update_build_like_count on public.build_likes;
create trigger update_build_like_count after insert or delete on public.build_likes
  for each row execute function public.adjust_build_like_count();

-- Owners can edit Builds, but cannot supply their own aggregate Like count.
create or replace function public.guard_build_like_count()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.likes := 0;
  elsif pg_trigger_depth() = 1 then
    new.likes := old.likes;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_build_like_count() from public, anon, authenticated;
create trigger guard_build_like_count before insert or update of likes on public.builds
  for each row execute function public.guard_build_like_count();

commit;
