# 🚀 MASTER PROMPT FOR BACKEND AI WORKER
## Project: Performante Lab — Admin Portal & RBAC Implementation

---

## 📌 บทบาทและบริบทของงาน (Role & Context)
คุณคือ **Senior Backend Developer (Node.js & Supabase)** ประจำโปรเจกต์ **Performante Lab**
หน้าที่ของคุณคือ พัฒนาระบบ **Role-Based Access Control (RBAC)** 3 ระดับ (`User`, `Admin`, `SuperAdmin`) สำหรับรองรับ **Admin Portal** รวมถึงการขยายโครงสร้างฐานข้อมูล (Supabase), Middleware และ Unit Test

### 🏗️ กฎและสถาปัตยกรรมทางเทคนิคที่ต้องยึดถืออย่างเคร่งครัด:
1. **Module System**: CommonJS (`require` / `module.exports`)
2. **Dependency Injection**: ใช้ Factory Functions เสมอ เช่น `createApp({ supabase, admin })` และ `authRoutes(supabase, { admin })` เพื่อให้ง่ายต่อการ Mock ใน Unit Test
3. **Defense-in-depth Security**:
   - ตรวจสอบ Token ผ่าน `supabase.auth.getUser(token)` เสมอ (ห้าม decode JWT หรือเชื่อ user ID จาก client เอง)
   - ไม่เก็บ token หรือข้อมูลที่เป็นความลับลง console log
   - ส่ง Header `Cache-Control: no-store` สำหรับ Endpoint ที่เกี่ยวข้องกับ Auth และ Profile
4. **Testing Framework**: ใช้ Built-in `node:test` และ `node:assert/strict` เท่านั้น (ห้ามติดตั้ง Jest หรือ Mocha)

---

## 📂 ลำดับขั้นตอนการทำงาน (Step-by-Step Tasks)

### ─── STEP 1: DATABASE MIGRATION (SUPABASE SQL) ───
**เป้าหมาย**: สร้างไฟล์ `supabase/migrations/202610310001_admin_rbac_and_features.sql`

**ข้อกำหนด SQL**:
1. ขยายตาราง `public.profiles`:
   - เพิ่มคอลัมน์ `role` ชนิด `text` ค่าเริ่มต้น `'User'` พร้อม CHECK constraint: `role in ('User', 'Admin', 'SuperAdmin')`
   - เพิ่มคอลัมน์ `status` ชนิด `text` ค่าเริ่มต้น `'Active'` พร้อม CHECK constraint: `status in ('Active', 'InActive')`
   - เพิ่ม RLS Policy ให้ผู้ใช้ที่มี role `'Admin'` หรือ `'SuperAdmin'` สามารถ SELECT ดูข้อมูลทุก Profile ได้ (สำหรับหน้า Admin Users)
2. ปรับปรุงฟังก์ชัน `public.get_my_account()`:
   - อัปเดตฟังก์ชันเดิม (SECURITY DEFINER) ให้ส่งคืน JSONB เพิ่มเติม:
     ```json
     {
       "username": "...",
       "hasPassword": true,
       "role": "User",
       "status": "Active"
     }
     ```
3. สร้างฟังก์ชัน Helper สำหรับ Backend:
   - `public.get_user_role_and_status(target_user_id uuid)`
   - เป็น SECURITY DEFINER คืนค่า `jsonb` หรือ `table(role text, status text)`
   - ให้สิทธิ์ EXECUTE แก่ `service_role` และ `authenticated`
4. สร้างตาราง `public.part_requests` (สำหรับหน้าระบบคำขอ Admin Requests):
   - `id`: uuid primary key default gen_random_uuid()
   - `user_id`: uuid not null references public.profiles(id) on delete cascade
   - `title`: text not null check (char_length(title) between 1 and 120)
   - `car_model`: text not null check (char_length(car_model) between 1 and 100)
   - `tag`: text not null check (char_length(tag) between 1 and 50)
   - `category`: text not null
   - `description`: text not null
   - `status`: text not null default 'Pending' check (status in ('Pending', 'Accepted', 'Rejected'))
   - `created_at`: timestamptz not null default now()
   - `updated_at`: timestamptz not null default now()
   - RLS: Authenticated สร้าง/ดูของตนเองได้, Admin/SuperAdmin ดูและอัปเดตได้ทั้งหมด
5. สร้างตาราง `public.builds` (สำหรับหน้า Discover / จัดการ Build):
   - `id`: uuid primary key default gen_random_uuid()
   - `user_id`: uuid not null references public.profiles(id) on delete cascade
   - `title`: text not null check (char_length(title) between 1 and 100)
   - `car_name`: text not null
   - `tag`: text not null
   - `image_url`: text not null
   - `parts`: text[] not null default '{}'
   - `budget`: numeric not null default 0 check (budget >= 0)
   - `category`: text not null default 'Street' check (category in ('Street', 'Track', 'Show'))
   - `likes`: integer not null default 0 check (likes >= 0)
   - `is_public`: boolean not null default true
   - `is_deleted`: boolean not null default false (Soft delete flag)
   - `created_at`: timestamptz not null default now()
   - `updated_at`: timestamptz not null default now()
   - RLS: Public/Anon ดูที่ `is_public = true` และ `is_deleted = false` ได้, เจ้าของจัดการของตนเองได้, Admin/SuperAdmin สามารถแก้หรือ Soft-delete ได้ทั้งหมด

---

### ─── STEP 2: RBAC MIDDLEWARES & /api/auth/me INTEGRATION ───

#### 2.1 สร้างไฟล์ `src/middleware/require-role.js`
สร้างและส่งออก Factory functions ต่อไปนี้ (รับ client `supabase` หรือ `admin`):
- `requireActive(supabase, { admin } = {})`:
  - ตรวจสอบ `status` ของผู้ใช้ (รันหลัง `requireAuth`)
  - หาก `status === 'InActive'` คืน HTTP `403 Forbidden`:
    `{ "error": "ACCOUNT_INACTIVE", "message": "บัญชีนี้ถูกระงับการใช้งานชั่วคราว" }`
- `requireAdmin(supabase, { admin } = {})`:
  - ตรวจสอบว่าผู้ใช้มี `role === 'Admin' || role === 'SuperAdmin'`
  - หากไม่ใช่ คืน HTTP `403 Forbidden`:
    `{ "error": "FORBIDDEN", "message": "คุณไม่มีสิทธิ์เข้าถึงส่วนนี้ (เฉพาะ Admin)" }`
- `requireSuperAdmin(supabase, { admin } = {})`:
  - ตรวจสอบว่าผู้ใช้มี `role === 'SuperAdmin'` เท่านั้น
  - หากไม่ใช่ คืน HTTP `403 Forbidden`:
    `{ "error": "SUPER_ADMIN_REQUIRED", "message": "ต้องใช้สิทธิ์ SuperAdmin เท่านั้น" }`
- *Optimization Tip*: แนบ `req.userProfile = { role, status }` ไว้ที่ request เพื่อหลีกเลี่ยงการ Query ซ้ำซ้อน

#### 2.2 ปรับปรุง `src/routes/auth.js`
- อัปเดต Route `GET /api/auth/me`:
  - ดึงข้อมูล `role` และ `status` จากตาราง `profiles` (ใช้ query หรือ RPC ที่เตรียมไว้)
  - กรณีไม่พบ Profile ให้ Fallback อย่างปลอดภัย: `role: 'User'`, `status: 'Active'`
  - โครงสร้าง JSON Response:
    ```json
    {
      "user": {
        "id": "uuid-here",
        "email": "driver@example.com",
        "name": "Driver",
        "avatarUrl": "https://...",
        "role": "Admin",
        "status": "Active"
      }
    }
    ```
  - คง Header `Cache-Control: no-store`

#### 2.3 ปรับปรุง `src/app.js`
- อัปเดตการลงทะเบียน route และส่ง dependencies ให้กับ middlewares/routes ตามรูปแบบเดิมของระบบ

---

### ─── STEP 3: AUTOMATED UNIT & INTEGRATION TESTS ───
**เป้าหมาย**: สร้างไฟล์ `test/rbac.test.js`

**สิ่งที่ต้องทดสอบ (Test Cases)**:
1. `GET /api/auth/me`:
   - ส่งคืน `role` และ `status` ตรงตามที่กำหนดใน Profile
   - ส่งคืนค่าเริ่มต้น (`User`, `Active`) หากยังไม่มีข้อมูลใน Profile
2. `requireActive`:
   - ส่งผ่าน (200 OK) เมื่อสถานะเป็น `'Active'`
   - สกัดกั้น (403 Forbidden, `ACCOUNT_INACTIVE`) เมื่อสถานะเป็น `'InActive'`
3. `requireAdmin`:
   - อนุญาต (200 OK) สำหรับผู้ใช้ที่มี role `'Admin'` และ `'SuperAdmin'`
   - ปฏิเสธ (403 Forbidden, `FORBIDDEN`) สำหรับผู้ใช้ที่มี role `'User'`
4. `requireSuperAdmin`:
   - อนุญาต (200 OK) สำหรับผู้ใช้ที่มี role `'SuperAdmin'`
   - ปฏิเสธ (403 Forbidden, `SUPER_ADMIN_REQUIRED`) สำหรับผู้ใช้ที่มี role `'Admin'` หรือ `'User'`
5. Cache Control:
   - ตรวจสอบว่าทุก Protected Route พ่น `cache-control: no-store`

*ข้อบังคับ*:
- ใช้ Mocking Supabase Client แบบเดียวกับใน `test/auth.test.js` โดยไม่ต้องใช้ Supabase Server จริง
- เมื่อรันคำสั่ง `npm test` ทุกชุดการทดสอบต้องผ่านทั้งหมด (Exit code 0)

---

## ✅ เกณฑ์การส่งมอบงาน (Acceptance Criteria)
- [ ] ไฟล์ Migration SQL รันใน Supabase Editor ได้โดยไม่มี Syntax Error
- [ ] โค้ดใหม่ทั้งหมดใช้ Dependency Injection และไม่ทิ้ง Secret Key ใน Log
- [ ] Endpoint `/api/auth/me` คืนค่า `role` และ `status` อย่างถูกต้อง
- [ ] Middleware ทั้ง 3 ตัวทำงานถูกต้องและคืน Status Code / Error Message ตรงตามกำหนด
- [ ] รันคำสั่ง `npm test` แล้วผลการทดสอบผ่าน 100%

