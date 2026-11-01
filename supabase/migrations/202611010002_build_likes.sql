begin;

create table if not exists public.build_likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  build_id uuid not null references public.builds(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, build_id)
);
create index if not exists build_likes_owner_created_idx
  on public.build_likes (user_id, created_at desc, build_id desc);

alter table public.build_likes enable row level security;
revoke all on public.build_likes from anon, authenticated;
grant select on public.build_likes to authenticated;
grant all on public.build_likes to service_role;
drop policy if exists "Users read own build likes" on public.build_likes;
create policy "Users read own build likes" on public.build_likes
  for select to authenticated using ((select auth.uid()) = user_id);

-- Writes go through the backend, which validates Active accounts and public builds.
-- Existing Builds, their visibility, and legacy likes counters are preserved.
commit;
