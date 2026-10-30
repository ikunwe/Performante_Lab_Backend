# 🚀 MASTER WORKER PROMPT: Create Supabase Storage Bucket (`catalog`) & Strict RLS
## Feature: การสร้าง Storage Bucket `catalog` บน Supabase พร้อม Row Level Security (RLS) และ Script ตรวจสอบผล

---

## 📌 บทบาทและบริบทของงาน (Role & Context)
คุณคือ **Senior Backend & Database Developer (Supabase & PostgreSQL)** ประจำโปรเจกต์ **Performante Lab**
หน้าที่ของคุณคือ สร้างและตั้งค่า Supabase Storage Bucket ชื่อ **`catalog`** ให้พร้อมใช้งานสำหรับระบบจัดเก็บรูปภาพของโปรเจกต์ โดยต้องเป็น **Public Bucket** พร้อมตั้งค่า **Row Level Security (RLS)** ให้บุคคลทั่วไปสามารถเรียกดูรูปภาพได้โดยตรง (Public CDN) และอนุญาตเฉพาะผู้ใช้ที่มีบทบาท **`Admin`** หรือ **`SuperAdmin`** เท่านั้นที่มีสิทธิ์อัปโหลด แก้ไข หรือลบรูปภาพ

---

## 🎯 ข้อกำหนดเชิงเทคนิค (Technical Specifications)

1. **Bucket Name & ID**: `catalog`
2. **Public Access**: `true` (เปิดให้อ่านไฟล์ได้โดยไม่ต้องผ่าน Signed URL)
3. **File Size Limit**: `10485760` bytes (10 MB)
4. **Allowed MIME Types**: `image/jpeg`, `image/png`, `image/webp`
5. **Security (Row Level Security - RLS)**:
   - บังคับใช้บนตาราง `storage.objects`
   - ตรวจสอบสิทธิ์ผู้เขียน/ลบผ่านฟังก์ชัน Security Definer: `public.is_admin_or_superadmin(auth.uid())`
   - ห้ามไม่ให้ Anonymous หรือ User ทั่วไปอัปโหลดไฟล์เข้ามาได้

---

## 📂 ลำดับงานที่ต้องทำ (Step-by-Step Tasks)

### ─── STEP 1: สร้าง SQL MIGRATION FILE ───
**ตำแหน่งไฟล์**: `Performante_Lab_Backend/supabase/migrations/202610310003_catalog_storage_bucket.sql`

เขียนคำสั่ง SQL สำหรับตั้งค่า Bucket และ RLS Policies ดังนี้:

```sql
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

-- 2. เปิดใช้งาน RLS บน storage.objects (โดยปกติเปิดอยู่แล้ว แต่ใส่เพื่อความชัวร์)
alter table storage.objects enable row level security;

-- 3. Policy: Public Read (ทุกคนทั้ง anon และ authenticated สามารถดูและดาวน์โหลดรูปได้)
drop policy if exists "Public read catalog assets" on storage.objects;
create policy "Public read catalog assets" on storage.objects
  for select
  using (bucket_id = 'catalog');

-- 4. Policy: Admin Upload (เฉพาะ Admin และ SuperAdmin เท่านั้นที่อัปโหลดได้)
drop policy if exists "Admins can upload catalog assets" on storage.objects;
create policy "Admins can upload catalog assets" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'catalog'
    and public.is_admin_or_superadmin(auth.uid())
  );

-- 5. Policy: Admin Update (เฉพาะ Admin และ SuperAdmin เท่านั้นที่แก้ไขไฟล์ได้)
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

-- 6. Policy: Admin Delete (เฉพาะ Admin และ SuperAdmin เท่านั้นที่ลบไฟล์ได้)
drop policy if exists "Admins can delete catalog assets" on storage.objects;
create policy "Admins can delete catalog assets" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'catalog'
    and public.is_admin_or_superadmin(auth.uid())
  );

commit;
```

---

### ─── STEP 2: วิธีการรัน MIGRATION (DEPLOYMENT INSTRUCTIONS) ───
ให้ระบุวิธีการรัน Migration ให้ผู้พัฒนาเลือกระหว่าง:

1. **ผ่าน Supabase Dashboard (SQL Editor)**:
   - นำโค้ด SQL ด้านบนไปวางในแท็บ **SQL Editor** บน Supabase Web Dashboard
   - กดปุ่ม **Run**
2. **ผ่าน Supabase CLI (Local Development)**:
   ```bash
   cd Performante_Lab_Backend
   npx supabase db push
   # หรือรัน migration file โดยตรง
   ```

---

### ─── STEP 3: เขียน AUTOMATED TEST ตรวจสอบความถูกต้อง ───
**ตำแหน่งไฟล์**: `Performante_Lab_Backend/test/catalog-storage.test.js`

เขียนชุดการทดสอบด้วย `node:test` และ `node:assert/strict` เพื่อยืนยันว่า:
1. มี SQL Migration ไฟล์นี้อยู่จริง และไม่มี Syntax ผิดพลาด
2. นโยบาย RLS ครอบคลุมทั้ง `select`, `insert`, `update`, `delete`
3. ค่า `public` ถูกตั้งเป็น `true` และจำกัด MIME Types เฉพาะรูปภาพ

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Catalog storage bucket migration sanity check", () => {
  const migrationPath = path.join(
    __dirname,
    "../supabase/migrations/202610310003_catalog_storage_bucket.sql"
  );

  assert.ok(fs.existsSync(migrationPath), "Migration file must exist");

  const sql = fs.readFileSync(migrationPath, "utf8");

  // ตรวจสอบ Bucket Configuration
  assert.match(sql, /'catalog'/, "Must specify bucket id as 'catalog'");
  assert.match(sql, /true/, "Must set bucket as public");
  assert.match(sql, /10485760/, "Must enforce 10MB file size limit");
  assert.match(sql, /image\/jpeg/, "Must allow JPEG");
  assert.match(sql, /image\/png/, "Must allow PNG");
  assert.match(sql, /image\/webp/, "Must allow WebP");

  // ตรวจสอบ RLS Policies
  assert.match(sql, /Public read catalog assets/, "Must have public read policy");
  assert.match(sql, /Admins can upload catalog assets/, "Must have admin upload policy");
  assert.match(sql, /Admins can update catalog assets/, "Must have admin update policy");
  assert.match(sql, /Admins can delete catalog assets/, "Must have admin delete policy");
  assert.match(sql, /is_admin_or_superadmin/, "Must check role using is_admin_or_superadmin()");
});
```

---

## 🧪 4. Testing & Verification Checklist
1. รันคำสั่งทดสอบใน `Performante_Lab_Backend`:
   ```bash
   cd Performante_Lab_Backend
   npm test
   ```
   *(เทสทั้งหมดรวมถึง `catalog-storage.test.js` ต้องผ่าน 100%)*
2. ตรวจสอบใน Supabase Storage Dashboard:
   - เข้าเมนู **Storage** ใน Supabase
   - ต้องพบ Bucket ชื่อ **`catalog`** พร้อมป้าย **Public**
   - ตรวจสอบในแท็บ **Policies** ต้องมี Policies 4 ตัวตามที่ระบุไว้

---

## 📋 Definition of Done
- [ ] ไฟล์ Migration `202610310003_catalog_storage_bucket.sql` ถูกสร้างขึ้นอย่างถูกต้อง
- [ ] Bucket `catalog` ถูกสร้างด้วยสถานะ Public และจำกัดขนาด 10MB
- [ ] อนุญาตเฉพาะไฟล์ `image/jpeg`, `image/png`, `image/webp`
- [ ] RLS Policy บล็อกการอัปโหลดจาก User ทั่วไป และอนุญาตเฉพาะ Admin/SuperAdmin
- [ ] ชุดทดสอบ `npm test` ใน Backend ผ่าน 100%

