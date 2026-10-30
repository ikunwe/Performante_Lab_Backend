# 🚀 MASTER WORKER PROMPT: Supabase Storage (`catalog` Bucket) & Upload Helper
## Feature: การตั้งค่า Supabase Storage Bucket, Security Policies (RLS) และ Helper ฟังก์ชันจัดเก็บรูปภาพตาม Tree Structure

---

## 📌 บทบาทและบริบทของงาน (Role & Context)
คุณคือ **Senior Full-Stack Developer (Supabase Storage & Node.js & Angular)** ประจำโปรเจกต์ **Performante Lab**
หน้าที่ของคุณคือ ตั้งค่า Supabase Storage Bucket ชื่อ **`catalog`** ให้เป็นแบบ **Public Bucket** พร้อมตั้งค่า **Row Level Security (RLS)** ให้บุคคลทั่วไปและหน้าบ้านสามารถอ่านรูปได้ (`public select`) และอนุญาตเฉพาะ Admin/SuperAdmin เท่านั้นที่สามารถอัปโหลด แก้ไข หรือลบรูปได้ พร้อมสร้าง **Path Helper Utility** สำหรับสร้าง Path ตรงตามโครงสร้าง Tree ที่กำหนด

---

## 📂 1. ข้อกำหนดทางเทคนิค (Technical Specifications)

### A. โครงสร้าง Path ใน Bucket `catalog`
```text
1. โลโก้แบรนด์:        {brand}/logo.{ext}
2. รูปรถต้นแบบ:        {brand}/{model}/CarPicture.{ext}
3. ชุดแต่ง BodyKit:    {brand}/{model}/BodyKit/{bodyKitBrand}/{type}.{ext}
4. ชิ้นส่วนพาร์ตแต่ง:    {brand}/{model}/Part/{partBrand}/{type}.{ext}
```
*(รองรับนามสกุลไฟล์ทั้ง `.jpg`, `.jpeg`, และ `.png`)*

---

## 📂 2. งานที่ต้องทำ (Step-by-Step Implementation)

### ─── STEP 1: SQL MIGRATION สำหรับ STORAGE BUCKET & RLS ───
**ไฟล์**: `Performante_Lab_Backend/supabase/migrations/202610310003_catalog_storage_bucket.sql`

สร้างคำสั่ง SQL สำหรับ:
1. แทรก/สร้าง Bucket `catalog` ในตาราง `storage.buckets` ให้ `public = true`, กำหนด `file_size_limit = 10485760` (10MB), และระบุ `allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']`
2. สร้าง Storage Policies บนตาราง `storage.objects`:
   - **Public Read**: ให้ทุกคน (anon, authenticated) สามารถอ่านและดาวน์โหลดรูปภาพจาก bucket `catalog` ได้
   - **Admin Insert/Update/Delete**: ตรวจสอบผ่านฟังก์ชัน `public.is_admin_or_superadmin(auth.uid())` ให้เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถอัปโหลด อัปเดต หรือลบไฟล์ได้

```sql
begin;

-- 1. สร้าง Bucket catalog หากยังไม่มี
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

-- 2. RLS: อนุญาตให้ทุกคนอ่านไฟล์ใน catalog bucket
drop policy if exists "Public read catalog assets" on storage.objects;
create policy "Public read catalog assets" on storage.objects
  for select
  using (bucket_id = 'catalog');

-- 3. RLS: อนุญาตเฉพาะ Admin/SuperAdmin อัปโหลดไฟล์
drop policy if exists "Admins can upload catalog assets" on storage.objects;
create policy "Admins can upload catalog assets" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'catalog'
    and public.is_admin_or_superadmin(auth.uid())
  );

-- 4. RLS: อนุญาตเฉพาะ Admin/SuperAdmin อัปเดตไฟล์
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

-- 5. RLS: อนุญาตเฉพาะ Admin/SuperAdmin ลบไฟล์
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

### ─── STEP 2: PATH BUILDER & UPLOAD HELPER UTILITY ───
**ไฟล์**: `Performante_Lab_Frontend/src/app/core/storage/catalog-storage.ts`

สร้าง Utility Class / Functions สำหรับจัดการการอัปโหลดและสร้าง Path ให้เป็นมาตรฐาน:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export class CatalogStorageHelper {
  static readonly BUCKET = 'catalog';

  /**
   * สร้าง Path โลโก้แบรนด์: {brand}/logo.{ext}
   */
  static getBrandLogoPath(brand: string, ext = 'png'): string {
    return `${this.sanitize(brand)}/logo.${ext}`;
  }

  /**
   * สร้าง Path รูปรถต้นแบบ: {brand}/{model}/CarPicture.{ext}
   */
  static getCarPicturePath(brand: string, model: string, ext = 'jpg'): string {
    return `${this.sanitize(brand)}/${this.sanitize(model)}/CarPicture.${ext}`;
  }

  /**
   * สร้าง Path ชุดแต่ง BodyKit: {brand}/{model}/BodyKit/{bodyKitBrand}/{type}.{ext}
   */
  static getBodyKitPath(
    brand: string,
    model: string,
    bodyKitBrand: string,
    typeName: string,
    ext = 'png',
  ): string {
    return `${this.sanitize(brand)}/${this.sanitize(model)}/BodyKit/${this.sanitize(bodyKitBrand)}/${this.sanitize(typeName)}.${ext}`;
  }

  /**
   * สร้าง Path ชิ้นส่วนพาร์ตแต่ง: {brand}/{model}/Part/{partBrand}/{type}.{ext}
   */
  static getPartPath(
    brand: string,
    model: string,
    partBrand: string,
    typeName: string,
    ext = 'png',
  ): string {
    return `${this.sanitize(brand)}/${this.sanitize(model)}/Part/${this.sanitize(partBrand)}/${this.sanitize(typeName)}.${ext}`;
  }

  /**
   * Helper สำหรับแปลงชื่อให้อยู่ในรูปแบบที่ปลอดภัยสำหรับ Storage Path
   */
  static sanitize(text: string): string {
    return text.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_\-\.]/g, '');
  }

  /**
   * อัปโหลดไฟล์ขึ้น Supabase Storage และคืนค่า Public URL
   */
  static async uploadFile(
    client: SupabaseClient,
    path: string,
    file: File | Blob,
    upsert = true,
  ): Promise<{ ok: boolean; url?: string; error?: string }> {
    try {
      const { data, error } = await client.storage
        .from(this.BUCKET)
        .upload(path, file, { upsert });

      if (error) throw error;

      const { data: publicData } = client.storage.from(this.BUCKET).getPublicUrl(path);
      return { ok: true, url: publicData.publicUrl };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Upload failed' };
    }
  }
}
```

---

## 🧪 3. Verification & Testing Checklist
1. **Migration Verification**:
   - รัน SQL Migration ใน Supabase และทดสอบตรวจสอบว่าตาราง `storage.buckets` มี bucket `'catalog'`
2. **Path Helper Unit Tests**:
   - สร้างไฟล์เทส `catalog-storage.spec.ts` ทดสอบความถูกต้องของ path ที่สร้างขึ้น
   - ตรวจสอบว่า `getBrandLogoPath('Ferrari')` ให้ค่า `'Ferrari/logo.png'`
   - ตรวจสอบว่า `getBodyKitPath('Ferrari', '488 Pista', 'Sano Design', 'Track Edition')` ให้ค่า `'Ferrari/488-Pista/BodyKit/Sano-Design/Track-Edition.png'`
3. **Frontend Tests**:
   ```bash
   cd Performante_Lab_Frontend
   npm test -- --watch=false
   npm run build
   ```

