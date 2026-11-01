# Performante Lab API

## User catalog from Storage

หน้า User (Catalog, Compare และตัวเลือก Create Build) อ่านโครงสร้างโฟลเดอร์ใน
bucket `catalog` ผ่าน `GET /api/catalog/storage` แล้ว ไม่ต้อง import ตาราง Catalog
และไม่มี SQL เพิ่ม ดู frontend `docs/storage-user-catalog.md` สำหรับ path และ cache

Backend cache รายการ 1 นาที, Frontend 5 นาที; `?refresh=1` อ่าน Storage ใหม่
ชื่อไฟล์ `logo.*` แยกจากสินค้า และ BodyKit หมายถึงชุดแต่งรอบคันเสมอ
Build ที่ใช้รหัส `storage-car:*` / `storage-part:*` ตรวจจาก Storage ฝั่ง server
ก่อนบันทึก ส่วน Build รุ่นเดิมยังตรวจด้วย catalog เดิมเพื่อรองรับข้อมูลเก่า
ต้อง restart Backend หลังแก้ routes

API อ้างอิงเดิม `/api/catalog/brands`, `/api/catalog/models` และ
`/api/catalog/models/export` ถูกถอดออกแล้ว (ตอบ 404) ข้อมูลในตาราง
`car_brand_reference` และไฟล์ dataset ยังคงอยู่ ไม่มี migration หรือการลบข้อมูล
ดู `data/README.md` สำหรับข้อมูลอ้างอิงและการรองรับ Build เก่า



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

Backend มี API อ่าน Catalog จาก Storage และบันทึก Builds แล้ว Google Login ทำผ่าน Supabase Auth ส่วนการตรวจสถานะบัญชีและสิทธิ์บน Backend ต้องใช้ `SUPABASE_SECRET_KEY` ฝั่ง server

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
- POST `/api/builds`: `{ id: UUID, name, category, carId, partIds }` บันทึกรายการใหม่เป็น private โดยกำหนด user_id จาก token เท่านั้น UUID เดิมกับ payload เดิมใช้ retry ได้
- PUT `/api/builds/:id`: `{ name, category, carId, partIds }` แก้ไขเฉพาะรายการของตัวเอง
- PATCH `/api/builds/:id/visibility`: `{ isPublic: boolean }` เปลี่ยนสถานะเฉพาะ Build ของเจ้าของที่ยังไม่ลบ ไม่แก้รถหรือพาร์ท
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

## Discover Builds

`GET /api/discover/builds?offset=0` อ่าน Build จริง ครั้งละ 100 รายการ พร้อม nextOffset
ไม่ส่ง token: เห็นเฉพาะรายการสาธารณะที่ยังไม่ลบ; ส่ง token ของบัญชี Active:
เห็นเฉพาะรายการสาธารณะทั้งของตัวเองและผู้อื่น ส่วน Build ส่วนตัวดูได้ใน My Builds เท่านั้น
response ไม่ส่ง user_id/email และใช้ Cache-Control: no-store

Frontend รีเฟรชหลังบันทึก/ลบ Build และมีปุ่มรีเฟรช Build ใหม่เป็น private ตั้งแต่ Save และเจ้าของเปลี่ยนสถานะได้ใน My Builds โดยไม่เปลี่ยน is_public ของข้อมูลเดิมอัตโนมัติ
ไม่มี SQL เพิ่ม รายละเอียดอยู่ใน frontend `docs/discover-builds.md`

Storage reader รองรับไฟล์มุม `45_front`, `front`, `45_Back`, `Back` และ `CarPicture` เดิม
รวมถึง BodyKit/{Manufacturer}/{Kit}/{angle} และ Part/{Category}/{Manufacturer}/{Part}/{angle}
ไม่มีการย้าย/เปลี่ยนชื่อไฟล์จริง ดู frontend docs/storage-user-catalog.md

Build category รองรับ Street / Track / Show และใช้คอลัมน์ category เดิม ไม่ต้องรัน SQL เพิ่ม
เมื่อ client เดิมไม่ส่ง category ใน PUT จะคงค่าเดิม ส่วน POST ใช้ Street เป็นค่าเริ่มต้น


## Requests API

รัน `supabase/migrations/202611010001_request_attachments.sql` และ restart Backend
เพิ่ม metadata/ภาพให้ตาราง part_requests เดิม และสร้าง private bucket request-attachments
ไม่ใช้ bucket catalog เก็บภาพคำขอ และไม่เพิ่มสินค้าใน Catalog อัตโนมัติเมื่อ Accept

- POST `/api/requests`: Active user ส่ง multipart field data (JSON) และ images (1–5 PNG/JPG/WebP รูปละไม่เกิน 10 MB)
- GET `/api/requests?offset=0`: รายการของเจ้าของ token เท่านั้น
- GET `/api/admin/requests?offset=0`: Active Admin/SuperAdmin อ่านทุกคำขอ
- PATCH `/api/admin/requests/:id/status`: Admin ส่ง `{status:"Accepted"|"Rejected"}`

Response ภาพเป็น signed URLs อายุ 1 ชั่วโมง ไม่เปิด bucket เป็น public
รายการแบ่งครั้งละ 100 พร้อม nextOffset และใช้ Cache-Control: no-store
การเขียนตารางนี้โดย browser ตรงถูกปิด ใช้ backend ทั้ง User และ Admin
POST จำกัด 10 ครั้งต่อบัญชีใน 10 นาที (memory ต่อ process)
และใช้ request UUID + content hash ป้องกันรายการซ้ำเมื่อ retry
กรณีอัปโหลดสำเร็จแต่ insert ล้มเหลว อาจมีไฟล์ private ค้างใต้ owner/request
เพื่อให้ retry ใช้ซ้ำ ไม่ลบไฟล์ที่อาจมีการ submit พร้อมกันสำเร็จ

`node scripts/smoke-requests-live.js` ทดสอบ Supabase จริงและล้างเฉพาะบัญชี/ข้อมูล/ภาพทดสอบ
ไม่รวมใน npm test รายละเอียด UI อยู่ frontend docs/requests-ui.md


## Likes API

รัน `supabase/migrations/202611010002_build_likes.sql` แล้ว restart Backend
ตาราง build_likes เก็บคู่ user_id/build_id ไม่ซ้ำและไม่เปลี่ยน Build เดิม
ทุก endpoint ต้องเป็นบัญชี Active และใช้ owner จาก token เท่านั้น

- GET `/api/likes/builds?offset=0`: Build สาธารณะที่บัญชีนี้ Like (ครั้งละ 100 พร้อม nextOffset)
- PUT `/api/likes/:buildId`: Like แบบ idempotent เฉพาะ Build สาธารณะที่ยังไม่ลบ
- DELETE `/api/likes/:buildId`: ลบ Like เฉพาะบัญชีนี้ (retry ได้)

User → เมนูโปรไฟล์ → Liked อ่านข้อมูลนี้ผ่าน backend
ไม่มีการแชร์ Like ข้ามบัญชี และ RLS ไม่ให้ browser เขียนตรง
รายละเอียดอยู่ frontend docs/likes.md
`node scripts/smoke-likes-live.js` เป็น opt-in cloud test ที่สร้างและล้างเฉพาะข้อมูลทดสอบ


ยอด Like จริงเก็บใน builds.likes โดยรัน migration
`supabase/migrations/202611010003_build_like_counts.sql` หลัง migration build_likes
migration คำนวณยอดเดิมจากแถวจริง และติด trigger เพิ่ม/ลดยอดเมื่อเพิ่ม/ลบ Like
การ retry หรือกดซ้ำไม่เพิ่มยอดซ้ำ มี guard ไม่ให้ client กำหนดยอดเอง
PUT/DELETE Like คืนยอดล่าสุดเพื่อใช้ปรับ UI ที่เปลี่ยนยอดล่วงหน้าให้ตรงกับฐานข้อมูล
