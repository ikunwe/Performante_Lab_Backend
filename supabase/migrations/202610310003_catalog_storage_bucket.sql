-- Migration: Create catalog storage bucket and enforce strict admin-only write RLS
begin;

-- 1. สร้าง Bucket 'catalog' ใน storage.buckets (รองรับ Idempotency ด้วย on conflict)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalog',
  'catalog',
  true,
  10485760, -- 10MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- 2. Policy: Public Read (ทุกคนทั้ง anon และ authenticated สามารถดูและดาวน์โหลดรูปได้)
drop policy if exists "Public read catalog assets" on storage.objects;
create policy "Public read catalog assets" on storage.objects
  for select
  using (bucket_id = 'catalog');

-- 3. Policy: Admin Upload (เฉพาะ Admin และ SuperAdmin เท่านั้นที่อัปโหลดได้)
drop policy if exists "Admins can upload catalog assets" on storage.objects;
create policy "Admins can upload catalog assets" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'catalog'
    and public.is_admin_or_superadmin(auth.uid())
  );

-- 4. Policy: Admin Update (เฉพาะ Admin และ SuperAdmin เท่านั้นที่แก้ไขไฟล์ได้)
drop policy if exists "Admins can update catalog assets" on storage.objects;
create policy "Admins can update catalog assets" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'catalog'
    and public.is_admin_or_superadmin(auth.uid())
  )
  with check (
    bucket_id = 'catalog'
    and public.is_admin_or_superadmin(auth.uid())
  );

-- 5. Policy: Admin Delete (เฉพาะ Admin และ SuperAdmin เท่านั้นที่ลบไฟล์ได้)
drop policy if exists "Admins can delete catalog assets" on storage.objects;
create policy "Admins can delete catalog assets" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'catalog'
    and public.is_admin_or_superadmin(auth.uid())
  );

commit;
