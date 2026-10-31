-- Migration: Grant permissions on car_brand_reference and fill missing logos
begin;

-- 1. Grant สิทธิ์การเข้าถึงตาราง car_brand_reference ให้ anon และ authenticated
grant select on public.car_brand_reference to anon, authenticated;
grant insert, update on public.car_brand_reference to authenticated;

-- 2. เปิดใช้งาน RLS และสร้าง Policies
alter table public.car_brand_reference enable row level security;

drop policy if exists "Public read car_brand_reference" on public.car_brand_reference;
create policy "Public read car_brand_reference" on public.car_brand_reference
  for select to anon, authenticated
  using (true);

drop policy if exists "Admins can insert car_brand_reference" on public.car_brand_reference;
create policy "Admins can insert car_brand_reference" on public.car_brand_reference
  for insert to authenticated
  with check (public.is_admin_or_superadmin(auth.uid()));

drop policy if exists "Admins can update car_brand_reference" on public.car_brand_reference;
create policy "Admins can update car_brand_reference" on public.car_brand_reference
  for update to authenticated
  using (public.is_admin_or_superadmin(auth.uid()))
  with check (public.is_admin_or_superadmin(auth.uid()));

-- 3. อัปเดตเติมรูปโลโก้คุณภาพสูง (Official Transparent PNG) ให้กับ 6 แบรนด์ที่ยังไม่มีรูป
update public.car_brand_reference
set details = jsonb_set(
  details,
  '{logoReferenceUrl}',
  to_jsonb('https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Jaecoo_logo.svg/512px-Jaecoo_logo.svg.png'::text)
)
where id = 'jaecoo';

update public.car_brand_reference
set details = jsonb_set(
  details,
  '{logoReferenceUrl}',
  to_jsonb('https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/GAC_Aion_logo.svg/512px-GAC_Aion_logo.svg.png'::text)
)
where id = 'aion';

update public.car_brand_reference
set details = jsonb_set(
  details,
  '{logoReferenceUrl}',
  to_jsonb('https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Denza_Logo.svg/512px-Denza_Logo.svg.png'::text)
)
where id = 'denza';

update public.car_brand_reference
set details = jsonb_set(
  details,
  '{logoReferenceUrl}',
  to_jsonb('https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Deepal_logo.svg/512px-Deepal_logo.svg.png'::text)
)
where id = 'deepal';

update public.car_brand_reference
set details = jsonb_set(
  details,
  '{logoReferenceUrl}',
  to_jsonb('https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Neta_Auto_logo.svg/512px-Neta_Auto_logo.svg.png'::text)
)
where id = 'neta';

update public.car_brand_reference
set details = jsonb_set(
  details,
  '{logoReferenceUrl}',
  to_jsonb('https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/ORA_logo.svg/512px-ORA_logo.svg.png'::text)
)
where id = 'ora';

commit;

