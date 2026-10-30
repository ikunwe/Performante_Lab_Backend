-- Migration: Car Catalog Schema (Brands, Models, Parts) & Recovery Seed
begin;

-- 1. ตาราง แบรนด์รถยนต์ (car_brands)
create table if not exists public.car_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  slug text not null unique check (char_length(slug) between 1 and 80),
  logo_url text not null,
  is_custom_bg boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. ตาราง รุ่นรถยนต์ (car_models)
create table if not exists public.car_models (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.car_brands(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  slug text not null check (char_length(slug) between 1 and 100),
  image_url text not null,
  body_type text not null default 'Coupe',
  year text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. ตาราง ชิ้นส่วนและชุดแต่ง (car_parts)
create table if not exists public.car_parts (
  id uuid primary key default gen_random_uuid(),
  car_model_id uuid not null references public.car_models(id) on delete cascade,
  category text not null check (char_length(category) between 1 and 60),
  name text not null check (char_length(name) between 1 and 120),
  manufacturer text not null check (char_length(manufacturer) between 1 and 80),
  image_url text not null,
  price numeric not null default 0 check (price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. ดัชนีเพื่อประสิทธิภาพการค้นหา (Indexes)
create index if not exists idx_car_models_brand_id on public.car_models(brand_id);
create index if not exists idx_car_parts_car_model_id on public.car_parts(car_model_id);
create index if not exists idx_car_parts_category on public.car_parts(category);

-- 5. เปิดใช้งาน ROW LEVEL SECURITY (RLS)
alter table public.car_brands enable row level security;
alter table public.car_models enable row level security;
alter table public.car_parts enable row level security;

-- ─── 5.1 RLS: car_brands ───
drop policy if exists "Public read car_brands" on public.car_brands;
create policy "Public read car_brands" on public.car_brands
  for select to anon, authenticated
  using (true);

drop policy if exists "Admins can insert car_brands" on public.car_brands;
create policy "Admins can insert car_brands" on public.car_brands
  for insert to authenticated
  with check (public.is_admin_or_superadmin(auth.uid()));

drop policy if exists "Admins can update car_brands" on public.car_brands;
create policy "Admins can update car_brands" on public.car_brands
  for update to authenticated
  using (public.is_admin_or_superadmin(auth.uid()))
  with check (public.is_admin_or_superadmin(auth.uid()));

drop policy if exists "Admins can delete car_brands" on public.car_brands;
create policy "Admins can delete car_brands" on public.car_brands
  for delete to authenticated
  using (public.is_admin_or_superadmin(auth.uid()));

-- ─── 5.2 RLS: car_models ───
drop policy if exists "Public read car_models" on public.car_models;
create policy "Public read car_models" on public.car_models
  for select to anon, authenticated
  using (true);

drop policy if exists "Admins can insert car_models" on public.car_models;
create policy "Admins can insert car_models" on public.car_models
  for insert to authenticated
  with check (public.is_admin_or_superadmin(auth.uid()));

drop policy if exists "Admins can update car_models" on public.car_models;
create policy "Admins can update car_models" on public.car_models
  for update to authenticated
  using (public.is_admin_or_superadmin(auth.uid()))
  with check (public.is_admin_or_superadmin(auth.uid()));

drop policy if exists "Admins can delete car_models" on public.car_models;
create policy "Admins can delete car_models" on public.car_models
  for delete to authenticated
  using (public.is_admin_or_superadmin(auth.uid()));

-- ─── 5.3 RLS: car_parts ───
drop policy if exists "Public read car_parts" on public.car_parts;
create policy "Public read car_parts" on public.car_parts
  for select to anon, authenticated
  using (true);

drop policy if exists "Admins can insert car_parts" on public.car_parts;
create policy "Admins can insert car_parts" on public.car_parts
  for insert to authenticated
  with check (public.is_admin_or_superadmin(auth.uid()));

drop policy if exists "Admins can update car_parts" on public.car_parts;
create policy "Admins can update car_parts" on public.car_parts
  for update to authenticated
  using (public.is_admin_or_superadmin(auth.uid()))
  with check (public.is_admin_or_superadmin(auth.uid()));

drop policy if exists "Admins can delete car_parts" on public.car_parts;
create policy "Admins can delete car_parts" on public.car_parts
  for delete to authenticated
  using (public.is_admin_or_superadmin(auth.uid()));

-- ─── 6. กู้คืนข้อมูลรูปภาพที่คุณได้อัปโหลดไว้แล้วใน Storage Bucket 'catalog' ───
insert into public.car_brands (id, name, slug, logo_url, is_custom_bg)
values
  ('b0000000-0000-0000-0000-000000000001', 'Ahoy', 'ahoy', 'https://oxzejsgfazbjjqopkzuf.supabase.co/storage/v1/object/public/catalog/Ahoy/logo.jpg', false),
  ('b0000000-0000-0000-0000-000000000002', 'dogdog', 'dogdog', 'https://oxzejsgfazbjjqopkzuf.supabase.co/storage/v1/object/public/catalog/dogdog/logo.png', false),
  ('b0000000-0000-0000-0000-000000000003', 'medic-boss', 'medic-boss', 'https://oxzejsgfazbjjqopkzuf.supabase.co/storage/v1/object/public/catalog/medic-boss/logo.png', false),
  ('b0000000-0000-0000-0000-000000000004', 'yeeyee', 'yeeyee', 'https://oxzejsgfazbjjqopkzuf.supabase.co/storage/v1/object/public/catalog/yeeyee/logo.jpg', false)
on conflict (name) do update set
  logo_url = excluded.logo_url;

-- กู้คืนรุ่นรถ asd ใต้แบรนด์ Ahoy ที่มีไฟล์ CarPicture.jpg อยู่แล้ว
insert into public.car_models (id, brand_id, name, slug, image_url, body_type)
values (
  'c0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'asd',
  'asd',
  'https://oxzejsgfazbjjqopkzuf.supabase.co/storage/v1/object/public/catalog/Ahoy/asd/CarPicture.jpg',
  'Coupe'
)
on conflict do nothing;

commit;
