# ชุดข้อมูลแบรนด์ของ Performante Lab

ชุดใช้งานปัจจุบันมี **28 แบรนด์** ตามขอบเขตโปรเจกต์ที่ตกลงกัน วันที่ 30 ต.ค. 2026 ไม่ใช่อันดับยอดขายหรือรายชื่อรถที่มีชุดแต่งครบแล้ว

- กลุ่มเริ่มต้น: Toyota, Honda, Isuzu, Mitsubishi, Nissan, Mazda, Suzuki, Ford, MG, BYD
- รถสปอร์ตและกลุ่มงานแต่ง: BMW, Mercedes-Benz, Subaru, Porsche, Ferrari, Lamborghini
- กลุ่มจีนเพิ่มเติม: GWM, Haval, ORA, NETA, AION, Changan, DEEPAL, Omoda, JAECOO, XPeng, Zeekr, Denza

MG และ BYD นับครั้งเดียว รวมทั้งหมด 28 แบรนด์ GWM ใช้ ID เดิม great-wall เพื่อรักษาตัวอ้างอิง ส่วน Haval และ ORA มี parentBrandId เป็น great-wall แยกแบรนด์ที่ผู้ใช้เลือกออกจากบริษัทแม่

## ไฟล์

- starter-brand-ids.json: allowlist ชุดใช้งาน แก้ที่นี่ก่อน regenerate
- car-brands.json / car-brands-starter.json: ชุดเดียวกัน 28 แบรนด์ พร้อมแหล่งอ้างอิง
- car-brands.csv: export ชุดใช้งาน
- ../../supabase/seeds/car-brand-reference.sql: transaction สำหรับ upsert แบรนด์ที่เลือกแล้วลบแบรนด์นอกชุด เฉพาะตาราง car_brand_reference
- official-additions.json และ raw/: หลักฐานต้นทางสำหรับสร้างข้อมูลซ้ำ ไม่ใช่รายการที่เปิดในเว็บไซต์

## สร้างข้อมูลซ้ำ

รัน npm run data:brands:offline จาก Backend เพื่อตรวจ checksum ของ raw แล้วสร้าง JSON/CSV/SQL เฉพาะ 28 แบรนด์ ไม่มีการเรียกเครือข่ายหรือเปลี่ยนฐานข้อมูล ส่วน npm run data:brands ใช้รีเฟรช snapshot แหล่งอ้างอิงก่อนกรอง allowlist เดิม

แหล่งต้นทาง: filippofilip95/car-logos-dataset ที่ commit e334a4d2e8742108ba164c629dff5636576d3808, NHTSA vPIC Passenger Car/MPV และหน้า official ตาม official-additions.json ข้อมูลทะเบียนสหรัฐฯ ใช้เป็นหลักฐานอ้างอิง ไม่ใช่หลักฐานยอดขายในไทย

## อัปเดต Supabase

npm run data:brands:plan อ่านรายการและแสดงจำนวนที่จะเปลี่ยน โดยไม่เขียนข้อมูล
npm run data:brands:sync สำรองแถวเดิมทั้งหมดลง tmp/car-brand-reference-backup-*.json ก่อน upsert ชุดใหม่และลบเฉพาะ IDs นอกชุดที่อยู่ใน backup แล้วอ่านกลับตรวจจำนวน/ID/ชื่ออีกครั้ง ใช้ SUPABASE_URL และ SUPABASE_SECRET_KEY จาก Backend .env เท่านั้น

REST sync ทำทีละขั้น หากขั้นใดล้มเหลวจะหยุดและต้องตรวจ backup ก่อนดำเนินต่อ หากใช้ SQL Editor ไฟล์ seed จะทำใน transaction ควรสำรองก่อนรัน ไม่ใช้ TRUNCATE หรือ CASCADE และไม่แก้ profiles, auth, models หรือ builds

อัปเดตจริงแล้วจาก 557 เป็น 28 แถววันที่ 30 ต.ค. 2026 มี backup เดิมอยู่ใน Backend tmp/ ห้ามลบทิ้งจนกว่าจะมั่นใจว่าข้อมูลใหม่ถูกต้อง

## การแสดงผลและข้อจำกัด

API scope=starter และ scope=all คงชื่อเดิมเพื่อรองรับ client เดิม แต่ทั้งคู่ส่งเฉพาะ allowlist ชุดใหม่ Frontend ไม่มีตัวเลือกชุดกว้างแล้ว Backend cache 1 ชั่วโมง จึงต้อง restart หลัง sync เพื่อใช้ snapshot ใหม่ทันที

ยังไม่มีการสร้างรุ่นรถ ปี ชุดแต่ง ราคา หรือ compatibility เพิ่มจากชื่อแบรนด์ isBuildReady ยังคง false จนกว่าจะมีข้อมูลรองรับจริง โลโก้เป็นเครื่องหมายการค้าของเจ้าของแบรนด์ ข้อมูลแหล่งรูปเพิ่มเติมอยู่ใน Frontend assets/brands/SOURCES.md
