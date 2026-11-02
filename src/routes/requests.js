const { Router, raw } = require("express");
const { rateLimit } = require("express-rate-limit");
const { requireAuth } = require("../middleware/require-auth");
const { requireActive } = require("../middleware/require-role");
const {
  BUCKET,
  UUID,
  columns,
  InvalidRequest,
  parseSubmission,
  requestDtos,
} = require("../services/requests");

function unavailable(res) {
  return res.status(503).json({
    error: "REQUESTS_UNAVAILABLE",
    message:
      "ระบบคำขอไม่พร้อมใช้งาน กรุณาตรวจ migration และ Storage หรือลองใหม่",
  });
}
function requestList(admin, own) {
  return async (req, res) => {
    const offset =
      req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
      return res.status(400).json({ error: "INVALID_PAGE" });
    try {
      let query = admin.from("part_requests").select(columns).neq("status", "Cancelled");
      if (own) query = query.eq("user_id", req.authUser.id);
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + 99);
      if (error || !Array.isArray(data)) return unavailable(res);
      return res.json({
        requests: await requestDtos(admin, data),
        nextOffset:
          data.length === 100 && offset + 100 <= 10000 ? offset + 100 : null,
      });
    } catch {
      return unavailable(res);
    }
  };
}
function requestsRoutes(supabase, { admin }) {
  const router = Router();
  router.use(requireAuth(supabase), requireActive(supabase, { admin }));
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get("/", requestList(admin, true));
  // Ownership and Pending are checked again in the write to prevent review races.
  router.patch("/:id/cancel", async (req, res) => {
    if (!UUID.test(req.params.id))
      return res.status(400).json({ error: "INVALID_REQUEST_ID" });
    try {
      const existing = await admin
        .from("part_requests")
        .select(columns)
        .eq("id", req.params.id)
        .eq("user_id", req.authUser.id)
        .maybeSingle();
      if (existing.error) return unavailable(res);
      if (!existing.data)
        return res.status(404).json({ error: "REQUEST_NOT_FOUND" });
      if (existing.data.status === "Cancelled")
        return res.json({
          request: (await requestDtos(admin, [existing.data]))[0],
        });
      if (existing.data.status !== "Pending")
        return res
          .status(409)
          .json({
            error: "REQUEST_NOT_PENDING",
            message: "คำขอนี้ได้รับการพิจารณาแล้ว ไม่สามารถยกเลิกได้",
          });
      const { data, error } = await admin
        .from("part_requests")
        .update({ status: "Cancelled", updated_at: new Date().toISOString() })
        .eq("id", req.params.id)
        .eq("user_id", req.authUser.id)
        .eq("status", "Pending")
        .select(columns)
        .maybeSingle();
      if (error) return unavailable(res);
      if (!data)
        return res
          .status(409)
          .json({
            error: "REQUEST_NOT_PENDING",
            message: "สถานะคำขอเปลี่ยนแล้ว กรุณารีเฟรชรายการ",
          });
      return res.json({ request: (await requestDtos(admin, [data]))[0] });
    } catch {
      return unavailable(res);
    }
  });
  router.post(
    "/",
    rateLimit({
      windowMs: 10 * 60 * 1000,
      limit: 10,
      keyGenerator: (req) => req.authUser.id,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    raw({ type: "multipart/form-data", limit: "51mb" }),
    async (req, res) => {
      try {
        const { data, images, hash } = await parseSubmission(req);
        const existing = await admin
          .from("part_requests")
          .select(columns)
          .eq("id", data.id)
          .eq("user_id", req.authUser.id)
          .maybeSingle();
        if (existing.error) return unavailable(res);
        if (existing.data) {
          if (existing.data.submission_hash !== hash)
            return res.status(409).json({
              error: "REQUEST_CONFLICT",
              message: "รหัสคำขอนี้ถูกใช้แล้ว กรุณาสร้างคำขอใหม่",
            });
          return res.json({
            request: (await requestDtos(admin, [existing.data]))[0],
          });
        }
        const paths = [];
        for (const image of images) {
          const path = `${req.authUser.id}/${data.id}/${image.hash}.${image.ext}`;
          const result = await admin.storage
            .from(BUCKET)
            .upload(path, image.bytes, {
              contentType: image.mime,
              upsert: true,
              cacheControl: "3600",
            });
          if (result.error) return unavailable(res);
          paths.push(path);
        }
        const { id, title, description, ...details } = data;
        const result = await admin
          .from("part_requests")
          .insert({
            id,
            user_id: req.authUser.id,
            title,
            description,
            car_model: (
              data.modelName ||
              data.brandName ||
              "ไม่ระบุรุ่น"
            ).slice(0, 100),
            tag: data.kind,
            category: data.kind,
            status: "Pending",
            request_details: details,
            image_paths: [...new Set(paths)],
            submission_hash: hash,
          })
          .select(columns)
          .single();
        if (result.error?.code === "23505") {
          const retry = await admin
            .from("part_requests")
            .select(columns)
            .eq("id", id)
            .eq("user_id", req.authUser.id)
            .maybeSingle();
          if (retry.error) return unavailable(res);
          if (retry.data?.submission_hash === hash)
            return res.json({
              request: (await requestDtos(admin, [retry.data]))[0],
            });
          return res.status(409).json({
            error: "REQUEST_CONFLICT",
            message: "รหัสคำขอนี้ถูกใช้แล้ว",
          });
        }
        if (result.error || !result.data) return unavailable(res);
        return res
          .status(201)
          .json({ request: (await requestDtos(admin, [result.data]))[0] });
      } catch (e) {
        if (e instanceof InvalidRequest)
          return res
            .status(400)
            .json({ error: "INVALID_REQUEST", message: e.message });
        return unavailable(res);
      }
    },
  );
  return router;
}
// Mounted behind the application's /api/admin Auth + Admin role middleware.
function adminRequestsRoutes({ admin }) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get("/", requestList(admin, false));
  router.patch("/:id/status", async (req, res) => {
    if (
      !UUID.test(req.params.id) ||
      !["Accepted", "Rejected"].includes(req.body?.status)
    )
      return res.status(400).json({ error: "INVALID_STATUS" });
    try {
      const { data, error } = await admin
        .from("part_requests")
        .update({
          status: req.body.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", req.params.id)
        .neq("status", "Cancelled")
        .select(columns)
        .maybeSingle();
      if (error) return unavailable(res);
      if (!data)
        return res
          .status(409)
          .json({
            error: "REQUEST_NOT_PENDING",
            message: "คำขอนี้ไม่อยู่ระหว่างรอพิจารณาแล้ว กรุณารีเฟรชรายการ",
          });
      return res.json({ request: (await requestDtos(admin, [data]))[0] });
    } catch {
      return unavailable(res);
    }
  });
  return router;
}
module.exports = { requestsRoutes, adminRequestsRoutes };
