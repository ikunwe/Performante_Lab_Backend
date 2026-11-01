-- Preserve requests and attachments; add the owner cancellation state.
begin;
alter table public.part_requests
  drop constraint if exists part_requests_status_check;
alter table public.part_requests
  add constraint part_requests_status_check
  check (status in ('Pending', 'Accepted', 'Rejected', 'Cancelled'));
commit;
