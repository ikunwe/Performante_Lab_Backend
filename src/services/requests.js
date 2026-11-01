const { createHash } = require("node:crypto");
const BUCKET = "request-attachments";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const columns =
  "id,user_id,title,car_model,tag,category,description,status,request_details,image_paths,submission_hash,created_at,updated_at,profiles(username)";
const kinds = ["brand", "model", "bodykit", "part"];
class InvalidRequest extends Error {}
function normalizeRequest(value) {
  if (!value || !UUID.test(value.id || "") || !kinds.includes(value.kind))
    throw new InvalidRequest("ประเภทหรือรหัสคำขอไม่ถูกต้อง");
  const limits = {
    title: 120,
    brandId: 200,
    modelId: 200,
    brandName: 100,
    modelName: 100,
    manufacturer: 100,
    description: 2000,
    source: 2000,
  };
  const data = { id: value.id, kind: value.kind };
  for (const [key, max] of Object.entries(limits)) {
    if (value[key] !== undefined && typeof value[key] !== "string")
      throw new InvalidRequest("ข้อมูลคำขอไม่ถูกต้อง");
    data[key] = (value[key] || "").trim();
    if (
      [...data[key]].length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(data[key])
    )
      throw new InvalidRequest("ข้อความยาวเกินกำหนดหรือมีอักขระไม่ถูกต้อง");
  }
  if (!data.title) throw new InvalidRequest("กรุณากรอก Title");
  if (data.kind !== "brand" && !data.brandName)
    throw new InvalidRequest("กรุณาระบุแบรนด์รถ");
  if (["bodykit", "part"].includes(data.kind) && !data.modelName)
    throw new InvalidRequest("กรุณาระบุรุ่นรถ");
  if (data.source) {
    try {
      if (!["https:", "http:"].includes(new URL(data.source).protocol))
        throw Error();
    } catch {
      throw new InvalidRequest("ลิงก์อ้างอิงต้องเป็น http:// หรือ https://");
    }
  }
  // Ignore privileged fields supplied by clients: owner/status/author are server-owned.
  return data;
}
function imageType(bytes) {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { mime: "image/png", ext: "png" };
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return { mime: "image/jpeg", ext: "jpg" };
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return { mime: "image/webp", ext: "webp" };
  return null;
}
async function parseSubmission(req) {
  if (!Buffer.isBuffer(req.body))
    throw new InvalidRequest(
      "กรุณาส่งข้อมูลพร้อมรูปภาพแบบ multipart/form-data",
    );
  let form;
  try {
    form = await new Request("http://localhost/requests", {
      method: "POST",
      headers: { "content-type": req.get("content-type") },
      body: req.body,
    }).formData();
  } catch {
    throw new InvalidRequest("อ่านข้อมูลและรูปภาพไม่สำเร็จ");
  }
  const raw = form.get("data");
  if (typeof raw !== "string" || raw.length > 15000)
    throw new InvalidRequest("ข้อมูลคำขอไม่ถูกต้อง");
  let data;
  try {
    data = normalizeRequest(JSON.parse(raw));
  } catch (e) {
    if (e instanceof InvalidRequest) throw e;
    throw new InvalidRequest("ข้อมูลคำขอไม่ถูกต้อง");
  }
  const incoming = form.getAll("images");
  if (incoming.length < 1 || incoming.length > 5)
    throw new InvalidRequest("กรุณาแนบรูป 1–5 รูป");
  const images = [];
  for (const file of incoming) {
    if (typeof file === "string" || !file.size || file.size > 10 * 1024 * 1024)
      throw new InvalidRequest("แต่ละรูปต้องมีขนาด 1 byte–10 MB");
    const bytes = Buffer.from(await file.arrayBuffer());
    const type = imageType(bytes);
    if (!type || type.mime !== file.type)
      throw new InvalidRequest(
        "รองรับไฟล์ภาพ PNG, JPG และ WebP ที่ถูกต้องเท่านั้น",
      );
    images.push({
      bytes,
      ...type,
      hash: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const hash = createHash("sha256")
    .update(JSON.stringify({ data, images: images.map((image) => image.hash) }))
    .digest("hex");
  return { data, images, hash };
}
async function requestDtos(admin, rows) {
  const paths = [
    ...new Set(
      rows.flatMap((row) =>
        (row.image_paths || []).filter(
          (path) =>
            typeof path === "string" &&
            path.startsWith(`${row.user_id}/${row.id}/`) &&
            !path.split("/").some((s) => s === "." || s === ".."),
        ),
      ),
    ),
  ];
  const signed = new Map();
  if (paths.length) {
    const result = await admin.storage
      .from(BUCKET)
      .createSignedUrls(paths, 3600);
    if (result.error) throw result.error;
    for (const image of result.data || []) {
      if (image.error || !image.signedUrl)
        throw new Error("Unable to sign attachment");
      signed.set(image.path, image.signedUrl);
    }
    if (signed.size !== paths.length)
      throw new Error("Incomplete signed attachments");
  }
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description || "",
    status: row.status,
    kind: kinds.includes(row.request_details?.kind)
      ? row.request_details.kind
      : "part",
    brandName: row.request_details?.brandName || "",
    modelName: row.request_details?.modelName || row.car_model || "",
    manufacturer: row.request_details?.manufacturer || "",
    source: row.request_details?.source || "",
    author: row.profiles?.username || "สมาชิก",
    images: (row.image_paths || []).flatMap((path) =>
      signed.has(path) ? [signed.get(path)] : [],
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
module.exports = {
  BUCKET,
  UUID,
  columns,
  InvalidRequest,
  normalizeRequest,
  parseSubmission,
  requestDtos,
};
