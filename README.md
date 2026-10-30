# Performante Lab API

Catalog API: `GET /api/catalog/brands?scope=starter` อ่านแบรนด์จาก `car_brand_reference` ใน Supabase และ cache ฝั่ง server 1 ชั่วโมง ใช้ `scope=all` สำหรับข้อมูลอ้างอิงทั้งหมด ต้อง restart Backend หลังเพิ่ม route นี้ Frontend มี memory/localStorage cache แยกตามโปรเจกต์และ scope รายละเอียดอยู่ที่ Frontend `docs/brand-cache.md`

Express API สำหรับตรวจ Supabase access token แยกจาก OAuth หน้าบ้าน โค้ดไม่รับ/จัดเก็บ Google Client Secret

1. กรอก `SUPABASE_URL` และ `SUPABASE_PUBLISHABLE_KEY` ใน `.env` จาก Supabase โปรเจกต์เดียวกับ Frontend
2. ตั้ง `FRONTEND_ORIGINS` เป็นรายการ origin ที่อนุญาต คั่นด้วย comma
3. `npm install` แล้ว `npm run dev` (พอร์ตเริ่มต้น 3000)

| Endpoint | Authentication | ผลลัพธ์ |
| --- | --- | --- |
| GET /api/health | ไม่ต้องมี | สถานะ API และว่ามี config Auth หรือไม่ |
| GET /api/auth/me | Bearer access token + บัญชี Active | ข้อมูลผู้ใช้ที่ Supabase ยืนยันแล้ว: id, email, name, avatarUrl, role, status |

ส่วนต่าง ๆ แยกใน `src/config`, `src/middleware`, `src/routes` และ `src/app.js` เพื่อเพิ่ม protected API ต่อได้ Middleware ใช้ `supabase.auth.getUser(token)` ไม่เชื่อ user ID ที่ส่งจาก browser ไม่บันทึก token ลง log และ response ของ Auth ใช้ `Cache-Control: no-store`

`npm test` ทดสอบ missing/invalid/expired token, valid user, outage/config error และ CORS โดย mock Supabase ส่วนทดสอบกับ cloud ต้องกรอก env ก่อน

คู่มือตั้ง Supabase, Google Cloud Console และตัวอย่าง env อยู่ใน Frontend: `docs/google-login-setup.md` ทั้งสอง repo มี `.env.example`; `.env` ไม่เข้า Git

Backend มี API อ่านแบรนด์/รุ่นรถและบันทึก Builds แล้ว Google Login ทำผ่าน Supabase Auth ส่วนการตรวจสถานะบัญชีและสิทธิ์บน Backend ต้องใช้ `SUPABASE_SECRET_KEY` ฝั่ง server

## Profile และ Username Login

รัน SQL ใน `supabase/migrations/202610290001_profiles.sql` แล้ว `supabase/migrations/202610290003_google_name_username.sql` ที่ Supabase SQL Editor เพื่อเพิ่ม username แบบไม่ซ้ำและฟังก์ชันสถานะบัญชี ซึ่งตรวจว่าตั้งรหัสผ่านจริงจาก Supabase Auth โดยไม่ส่ง password hash ออกมา Username เริ่มต้นจากชื่อ Google รองรับภาษาไทยและเว้นวรรค และเปลี่ยนเองได้ หากเคยรัน 001/002 แล้วให้รันเฉพาะ 003

`POST /api/auth/login` รับ JSON `{ "username": "driver", "password": "..." }` และคืน access_token/refresh_token หลังตรวจรหัสผ่านและสถานะ Active สำเร็จเท่านั้น คีย์ `SUPABASE_SECRET_KEY` ใน Backend `.env` จำเป็นสำหรับค้นหาบัญชีจาก username และตรวจสิทธิ์/สถานะบัญชี ห้ามใช้คีย์นี้ใน Frontend การยืนยันตัวตน Google และตั้งค่าโปรไฟล์ผ่าน Supabase SDK โดยตรงยังทำที่ Frontend

รายละเอียดการตั้งค่าอยู่ที่ Frontend `docs/profile-setup.md` มี rate limit สำหรับ Username Login แต่ยังเป็น memory store ต่อ process; ก่อน deploy หลาย process ให้ตั้ง store ร่วมกันและ trust proxy ให้ตรงกับระบบจริง

## RBAC หลัง merge

- `/api/auth/me` ตรวจ token และสถานะบัญชีด้วย private backend client ก่อนคืนข้อมูล บัญชี `InActive` ได้ 403; ตรวจ profile ไม่สำเร็จ ค่าบทบาท/สถานะไม่ถูกต้อง หรือไม่ได้ตั้ง private client ได้ 503 โดยไม่เปิดเผยข้อความภายใน
- Profile ที่ยืนยันจากฐานข้อมูลแล้วว่าไม่มีแถว ได้สิทธิ์เริ่มต้น User/Active เพื่อรองรับผู้ใช้ใหม่ กรณี query ล้มเหลวไม่ถือว่าเป็นผู้ใช้ใหม่
- Username Login ตรวจสถานะหลังยืนยันรหัสผ่าน ก่อนส่ง token ออกมา การป้องกันนี้ครอบคลุม API ของ Backend ไม่ใช่การปิด Supabase Auth session หรือป้องกันการเข้าฐานข้อมูลตรงจาก Frontend; การเข้าฐานข้อมูลตรงต้องบังคับด้วย RLS ของแต่ละตาราง
- กลุ่ม `/api/admin` และ `/api/super-admin` ตรวจ token, Active และ role ก่อนลงทะเบียน extension routes ผ่าน `createApp({ routes })` แล้ว แต่ยังไม่มี CRUD Admin API ใหม่
- `requireAdmin` และ `requireSuperAdmin` ตรวจ Active ในตัว ใช้ร่วมกับ `requireAuth` เสมอ `/api/catalog` ยังคงเป็นข้อมูลสาธารณะ
- SQL `202610310001_admin_rbac_and_features.sql` ใช้ค่า default เฉพาะตอนเพิ่มคอลัมน์ ไม่รีเซ็ต role/status ของบัญชีเดิมเมื่อรันซ้ำ การแก้รอบนี้ไม่ต้องเปลี่ยนข้อมูลใน Supabase และไม่ได้กู้สิทธิ์ที่อาจเคยถูก SQL รุ่นเก่ารีเซ็ตไปแล้ว

`.gitattributes` ป้องกัน Git แปลง newline ของ source snapshots ใน `data/reference/raw` และไฟล์ `.gz` เพื่อรักษา SHA-256 เดิมทั้ง Windows และ Linux ห้ามแก้ checksum ให้ยอมรับข้อมูลที่เปลี่ยนเนื้อหา

## My Builds API

ทุก endpoint ใต้ `/api/builds` ต้องใช้ Bearer token และบัญชี Active:

- GET `/api/builds?offset=0`: โหลด Build ของตัวเอง ครั้งละ 100 รายการ พร้อม nextOffset
- POST `/api/builds`: `{ id: UUID, name, carId, partIds }` บันทึกรายการใหม่เป็น private โดยกำหนด user_id จาก token เท่านั้น UUID เดิมกับ payload เดิมใช้ retry ได้
- PUT `/api/builds/:id`: `{ name, carId, partIds }` แก้ไขเฉพาะรายการของตัวเอง
- DELETE `/api/builds/:id`: soft delete เฉพาะรายการของตัวเอง (retry ได้)

ใช้ตาราง builds เดิม ไม่ต้องรัน SQL เพิ่ม โดย title = name, tag = stable carId,
parts = part IDs และ image_url = ภาพจาก catalog ฝั่ง server ข้อมูลรถ canonical
ถูกสร้างเป็น carSnapshot ใน response ไม่เชื่อข้อมูลรถหรือเจ้าของที่ browser ส่งมา
Full Body Kit ใช้ร่วมกับพาร์ทแยกไม่ได้ แต่ละหมวดเลือกได้หนึ่งรายการ

`data/build-assets.json` คือข้อมูลตรวจสอบ asset/part ที่ส่งออกจาก frontend watcher
และ prebuild ต้อง commit/deploy ไฟล์นี้พร้อม backend ให้ตรงกับ assets เวอร์ชันที่ใช้
ถ้าแยก repo คนละที่ ให้คัดลอก frontend assets/build-catalog.json มายังไฟล์นี้
อ่านรายละเอียดเพิ่มที่ frontend docs/cloud-builds.md ภาพจริงไม่ถูกส่งเข้าฐานข้อมูล

`node scripts/smoke-builds-live.js` เป็น smoke test แบบเลือกเรียกเอง ต้องตั้ง env แล้ว
สคริปต์สร้างบัญชีชั่วคราวที่ยืนยันอีเมลแล้ว (ไม่ส่งเมล) ทดสอบ API กับ Supabase จริง
และล้างเฉพาะบัญชี/ข้อมูลทดสอบของตัวเองหลังจบ ไม่อยู่ใน npm test ปกติ
