# 🚀 MASTER IMPLEMENTATION PROMPT FOR BACKEND AI WORKER
## Feature: Admin Users Management & Strict RBAC Permissions Matrix

---

## 📌 บทบาทและบริบทของงาน (Role & Context)
คุณคือ **Senior Backend Developer (Node.js & Supabase)** ประจำโปรเจกต์ **Performante Lab**
หน้าที่ของคุณคือ พัฒนาระบบ **Admin Users Management API** และบังคับใช้ **Strict RBAC Permissions Matrix** สำหรับจัดการผู้ใช้ในระบบ โดยเชื่อมโยงข้อมูลระหว่าง `auth.users` (Email จริง) และ `public.profiles` (`username`, `role`, `status`) พร้อมเขียน Unit/Integration Tests ด้วย `node:test`

### 🏗️ กฎและสถาปัตยกรรมทางเทคนิคที่ต้องยึดถืออย่างเคร่งครัด:
1. **Module System**: CommonJS (`require` / `module.exports`)
2. **Dependency Injection**: Route ต้องเขียนเป็น Factory Function รับ `{ admin, supabase }` เช่น `adminRoutes({ admin, supabase })`
3. **Fail-Closed & Defense-in-depth**:
   - ตรวจสอบ Token และ Role ของผู้เรียกก่อนเสมอ
   - ห้ามเชื่อ client-supplied identity
   - ส่ง Header `Cache-Control: no-store` บนทุก Admin Endpoint
4. **Testing Framework**: ใช้ Built-in `node:test` และ `node:assert/strict` (ห้ามติดตั้ง library ภายนอกเพิ่ม)

---

## 🛡️ RBAC Permissions Matrix ที่ต้องบังคับใช้อย่างเคร่งครัด

| บทบาทผู้เรียก (Actor) | การกระทำ (Action) | เป้าหมาย (Target User) | ผลลัพธ์ที่ถูกต้อง |
| :--- | :--- | :--- | :--- |
| **SuperAdmin** | ปรับเปลี่ยน Role | `User`, `Admin`, `SuperAdmin` | ✅ **200 OK** |
| **SuperAdmin** | สลับสถานะ Active/InActive | `User`, `Admin` | ✅ **200 OK** |
| **SuperAdmin** | สลับสถานะ Active/InActive | `SuperAdmin` (ตนเองหรือผู้อื่น) | ❌ **400 BAD_REQUEST** (`INVALID_OPERATION` - ห้ามระงับ SuperAdmin) |
| **Admin** | ปรับเปลี่ยน Role | ใดๆ | ❌ **403 FORBIDDEN** (`SUPER_ADMIN_REQUIRED`) |
| **Admin** | สลับสถานะ Active/InActive | `User` | ✅ **200 OK** |
| **Admin** | สลับสถานะ Active/InActive | `Admin` หรือ `SuperAdmin` | ❌ **403 FORBIDDEN** (`FORBIDDEN` - Admin จัดการได้เฉพาะ User) |

---

## 📂 ลำดับขั้นตอนการทำงาน (Step-by-Step Tasks)

### ─── STEP 1: SQL MIGRATION (DATABASE HELPER) ───
**เป้าหมาย**: สร้างไฟล์ Migration `supabase/migrations/202610310002_admin_users_view.sql` (หรือเพิ่มใน migration ล่าสุด)

**ข้อกำหนด SQL**:
สร้างฟังก์ชัน Security Definer ใน PostgreSQL เพื่อให้ Admin/SuperAdmin สามารถดึงข้อมูลผู้ใช้พร้อม Email จาก `auth.users` ได้อย่างปลอดภัย:
```sql
create or replace function public.admin_list_users()
returns table (
  id uuid,
  username text,
  email varchar(255),
  role text,
  status text,
  joined_at timestamptz
) language plpgsql security definer set search_path = '' as $$
begin
  -- ตรวจสอบว่าผู้เรียกต้องเป็น Admin หรือ SuperAdmin
  if not public.is_admin_or_superadmin(auth.uid()) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return query
    select
      p.id,
      p.username,
      u.email::varchar(255),
      coalesce(p.role, 'User') as role,
      coalesce(p.status, 'Active') as status,
      coalesce(u.created_at, p.updated_at) as joined_at
    from public.profiles p
    left join auth.users u on u.id = p.id
    order by u.created_at desc nulls last;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated, service_role;
```

---

### ─── STEP 2: พัฒนา `src/routes/admin.js` ───
**เป้าหมาย**: สร้าง Route Module `adminRoutes({ admin, supabase })`

#### 1. `GET /api/admin/users`
- **Middlewares**: `requireAuth(supabase)`, `requireActive(supabase, { admin })`, `requireAdmin(supabase, { admin })`
- **หน้าที่**:
  - เรียก RPC `admin_list_users()` ผ่าน `supabase` (หรือ query ผ่าน `admin` service role client)
  - แมปข้อมูลส่งกลับในรูปแบบ:
    ```json
    {
      "users": [
        {
          "id": "uuid",
          "username": "driver1",
          "email": "driver1@gmail.com",
          "role": "User",
          "status": "Active",
          "joinedAt": "2026-10-30T10:00:00.000Z"
        }
      ]
    }
    ```
  - ตั้ง Header `Cache-Control: no-store`

#### 2. `PATCH /api/admin/users/:id/status`
- **Middlewares**: `requireAuth(supabase)`, `requireActive(supabase, { admin })`, `requireAdmin(supabase, { admin })`
- **Input Validation**:
  - ตรวจสอบ `req.params.id` ต้องเป็น UUID v4 ที่ถูกต้อง
  - ตรวจสอบ `req.body.status` ต้องเป็น `'Active'` หรือ `'InActive'`
  - หากไม่ถูกต้อง คืน `400 INVALID_REQUEST`
- **Business Logic Enforcement**:
  - ดึงข้อมูลเป้าหมาย (Target User) จากตาราง `profiles`:
    - หากไม่พบ คืน `404 NOT_FOUND`
  - ตรวจสอบสิทธิ์ของผู้กระทำ (`req.userProfile.role` หรือ Actor Role):
    - **กรณี Actor เป็น `Admin`**:
      - ถ้า `target.role === 'Admin'` หรือ `target.role === 'SuperAdmin'`
        $\rightarrow$ คืน `403 FORBIDDEN` พร้อม message: `"Admin สามารถจัดการได้เฉพาะผู้ใช้ทั่วไป (User) เท่านั้น"`
    - **กรณี Actor เป็น `SuperAdmin`**:
      - ถ้า `target.role === 'SuperAdmin'`
        $\rightarrow$ คืน `400 INVALID_OPERATION` พร้อม message: `"ไม่สามารถระงับบัญชี SuperAdmin ได้"`
  - ทำการ Update คอลัมน์ `status` ใน `profiles` ผ่าน `admin` (service role)
  - คืน `200 OK`:
    ```json
    {
      "success": true,
      "user": {
        "id": "uuid",
        "status": "InActive"
      }
    }
    ```

#### 3. `PATCH /api/admin/users/:id/role`
- **Middlewares**: `requireAuth(supabase)`, `requireActive(supabase, { admin })`, `requireSuperAdmin(supabase, { admin })`
- **Input Validation**:
  - ตรวจสอบ `req.params.id` ต้องเป็น UUID v4
  - ตรวจสอบ `req.body.role` ต้องเป็น `'User'`, `'Admin'`, หรือ `'SuperAdmin'`
  - หากไม่ถูกต้อง คืน `400 INVALID_REQUEST`
- **Business Logic Enforcement**:
  - ดึงข้อมูลเป้าหมายจาก `profiles` (หากไม่พบ คืน `404 NOT_FOUND`)
  - อัปเดตคอลัมน์ `role` ใน `profiles` ผ่าน `admin` client
  - คืน `200 OK`:
    ```json
    {
      "success": true,
      "user": {
        "id": "uuid",
        "role": "Admin"
      }
    }
    ```

---

### ─── STEP 3: MOUNT ROUTE ใน `src/app.js` ───
ใน `src/app.js`:
- นำเข้า `adminRoutes` จาก `./routes/admin`
- ติดตั้งเข้ากับ Express App:
  ```javascript
  app.use("/api/admin", adminRoutes({ admin, supabase }));
  ```

---

### ─── STEP 4: AUTOMATED UNIT & INTEGRATION TESTS (`test/admin-users.test.js`) ───
**เป้าหมาย**: สร้างไฟล์ `test/admin-users.test.js` ด้วย `node:test` และ `node:assert/strict`

**Test Cases ที่ต้องครอบคลุม**:
1. `GET /api/admin/users` ปฏิเสธคำขอจากผู้ใช้ทั่วไป (403 FORBIDDEN)
2. `GET /api/admin/users` อนุญาต Admin/SuperAdmin และคืนรายการผู้ใช้พร้อม email จริง (200 OK)
3. `PATCH /api/admin/users/:id/status`:
   - Admin ระงับ User สำเร็จ (200 OK)
   - Admin พยายามระงับ Admin คนอื่น $\rightarrow$ ถูกปฏิเสธ (403 FORBIDDEN)
   - Admin พยายามระงับ SuperAdmin $\rightarrow$ ถูกปฏิเสธ (403 FORBIDDEN)
   - SuperAdmin ระงับ Admin สำเร็จ (200 OK)
   - SuperAdmin พยายามระงับบัญชี SuperAdmin $\rightarrow$ ถูกปฏิเสธ (400 INVALID_OPERATION)
4. `PATCH /api/admin/users/:id/role`:
   - Admin ทั่วไปพยายามเปลี่ยน Role $\rightarrow$ ถูกสกัดกั้นโดย middleware (403 SUPER_ADMIN_REQUIRED)
   - SuperAdmin เปลี่ยน Role ของ User ให้เป็น Admin ได้สำเร็จ (200 OK)
5. ตรวจสอบว่าทุก endpoint ส่ง Header `cache-control: no-store`

*เงื่อนไขการผ่านงาน*:
- รันคำสั่ง `npm test` ทุกชุดการทดสอบต้องผ่านทั้งหมด 100% (ทั้งเทสต์เดิมและเทสต์ใหม่)

---

## ✅ เกณฑ์การส่งมอบงาน (Acceptance Criteria)
- [ ] ไฟล์ Migration SQL ใหม่สร้างขึ้นอย่างถูกต้องพร้อม RLS/Security Definer
- [ ] `src/routes/admin.js` รองรับครบทั้ง 3 Endpoints ตาม Matrix
- [ ] `src/app.js` เชื่อมต่อ Route เรียบร้อย
- [ ] `test/admin-users.test.js` ครอบคลุม 100% ของ Business Rules
- [ ] รันคำสั่ง `npm test` ใน Backend ผ่านทุกชุดการทดสอบ (Exit code 0)

