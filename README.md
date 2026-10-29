# Performante Lab API

Express API สำหรับตรวจ Supabase access token แยกจาก OAuth หน้าบ้าน โค้ดไม่รับ/จัดเก็บ Google Client Secret

1. กรอก `SUPABASE_URL` และ `SUPABASE_PUBLISHABLE_KEY` ใน `.env` จาก Supabase โปรเจกต์เดียวกับ Frontend
2. ตั้ง `FRONTEND_ORIGINS` เป็นรายการ origin ที่อนุญาต คั่นด้วย comma
3. `npm install` แล้ว `npm run dev` (พอร์ตเริ่มต้น 3000)

| Endpoint | Authentication | ผลลัพธ์ |
| --- | --- | --- |
| GET /api/health | ไม่ต้องมี | สถานะ API และว่ามี config Auth หรือไม่ |
| GET /api/auth/me | Bearer access token | ข้อมูลผู้ใช้ที่ Supabase ยืนยันแล้ว: id, email, name, avatarUrl |

ส่วนต่าง ๆ แยกใน `src/config`, `src/middleware`, `src/routes` และ `src/app.js` เพื่อเพิ่ม protected API ต่อได้ Middleware ใช้ `supabase.auth.getUser(token)` ไม่เชื่อ user ID ที่ส่งจาก browser ไม่บันทึก token ลง log และ response ของ Auth ใช้ `Cache-Control: no-store`

`npm test` ทดสอบ missing/invalid/expired token, valid user, outage/config error และ CORS โดย mock Supabase ส่วนทดสอบกับ cloud ต้องกรอก env ก่อน

คู่มือตั้ง Supabase, Google Cloud Console และตัวอย่าง env อยู่ใน Frontend: `docs/google-login-setup.md` ทั้งสอง repo มี `.env.example`; `.env` ไม่เข้า Git

Backend นี้ยังไม่มี API เก็บ Builds หรือข้อมูลรถ Google Login ทำผ่าน Supabase Auth ไม่จำเป็นต้องใช้ service_role key หรือ database password

## Profile และ Username Login

รัน SQL ใน `supabase/migrations/202610290001_profiles.sql` แล้ว `supabase/migrations/202610290003_google_name_username.sql` ที่ Supabase SQL Editor เพื่อเพิ่ม username แบบไม่ซ้ำและฟังก์ชันสถานะบัญชี ซึ่งตรวจว่าตั้งรหัสผ่านจริงจาก Supabase Auth โดยไม่ส่ง password hash ออกมา Username เริ่มต้นจากชื่อ Google รองรับภาษาไทยและเว้นวรรค และเปลี่ยนเองได้ หากเคยรัน 001/002 แล้วให้รันเฉพาะ 003

`POST /api/auth/login` รับ JSON `{ "username": "driver", "password": "..." }` และคืน access_token/refresh_token หลังตรวจรหัสผ่านกับ Supabase สำเร็จเท่านั้น คีย์ `SUPABASE_SECRET_KEY` ใน Backend `.env` จำเป็นสำหรับค้นหาบัญชีจาก username แบบส่วนตัว ห้ามใช้คีย์นี้ใน Frontend ไม่จำเป็นสำหรับ Google Login หรือการตั้งค่าโปรไฟล์ของตัวเอง

รายละเอียดการตั้งค่าอยู่ที่ Frontend `docs/profile-setup.md` มี rate limit สำหรับ Username Login แต่ยังเป็น memory store ต่อ process; ก่อน deploy หลาย process ให้ตั้ง store ร่วมกันและ trust proxy ให้ตรงกับระบบจริง
