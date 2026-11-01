begin;

-- Extend existing requests without replacing or removing submitted records.
alter table public.part_requests
  add column if not exists request_details jsonb not null default '{}'::jsonb,
  add column if not exists image_paths text[] not null default '{}',
  add column if not exists submission_hash text;

-- All writes now go through the authenticated backend (including Admin reviews).
-- The existing owner/Admin SELECT policies remain in place.
revoke insert, update on public.part_requests from authenticated;
grant select on public.part_requests to authenticated;
grant all on public.part_requests to service_role;

create index if not exists part_requests_owner_created_idx
  on public.part_requests (user_id, created_at desc, id desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('request-attachments', 'request-attachments', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No direct browser Storage policies: the backend uploads and creates signed URLs
-- only after checking request ownership or Admin role.
commit;
