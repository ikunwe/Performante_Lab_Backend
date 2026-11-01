const { createStorageCatalog } = require("../services/storage-catalog");
const { Router } = require("express");
const { requireAuth } = require("../middleware/require-auth");
const { requireActive } = require("../middleware/require-role");
const {
  readBuildAssets,
  resolveCar,
  partsFor,
  coverImage,
} = require("../services/build-catalog");
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const columns =
  "id,title,tag,car_name,image_url,parts,category,is_public,created_at,updated_at";
function dto(row, assets) {
  const car = resolveCar(row.tag, assets);
  return {
    id: row.id,
    name: row.title,
    carId: row.tag,
    ...(car
      ? { carSnapshot: car }
      : {
          carSnapshot: {
            id: row.tag,
            brand: "",
            name: row.car_name,
            body: "",
            image: row.image_url,
          },
        }),
    partIds: row.parts,
    category: row.category || 'Street',
    isPublic: row.is_public === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function payload(input, assets) {
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    [...input.name.trim()].length > 80 ||
    /[\u0000-\u001f\u007f]/.test(input.name) ||
    (input.category !== undefined && !['Street','Track','Show'].includes(input.category)) ||
    typeof input.carId !== "string" ||
    !Array.isArray(input.partIds) ||
    input.partIds.length > 9 ||
    input.partIds.some((id) => typeof id !== "string" || id.length > 100)
  )
    return null;
  const car = resolveCar(input.carId, assets);
  if (!car) return null;
  const available = partsFor(car, assets);
  const selected = input.partIds.map((id) =>
    available.find((part) => part.id === id),
  );
  if (
    selected.some((part) => !part) ||
    new Set(selected.map((part) => part.category)).size !== selected.length ||
    (selected.length > 1 &&
      selected.some((part) => part.category === "bodykits"))
  )
    return null;
  return {
    title: input.name.trim(),
    ...(input.category !== undefined ? {category:input.category} : {}),
    tag: car.id,
    car_name: car.name,
    parts: [...input.partIds],
    image_url: coverImage(car, selected, assets),
  };
}
function buildsRoutes(
  supabase,
  {
    admin,
    assets = readBuildAssets,
    now = () => new Date().toISOString(),
  } = {},
) {
  const router = Router();
  const storage = createStorageCatalog({ admin });
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(requireAuth(supabase), requireActive(supabase, { admin }));
  const unavailable = (res) =>
    res.status(503).json({
      error: "BUILDS_UNAVAILABLE",
      message: "เชื่อมต่อข้อมูล Build ไม่สำเร็จ กรุณาลองใหม่",
    });
  const query = () => admin.from("builds");
  router.get("/", async (req, res) => {
    const offset =
      req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
      return res.status(400).json({ error: "INVALID_PAGE" });
    try {
      const { data, error } = await query()
        .select(columns)
        .eq("user_id", req.authUser.id)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + 99);
      if (error) return unavailable(res);
      const storageData = data.some((row) => row.tag.startsWith("storage-car:"))
        ? await storage.get()
        : null;
      return res.json({
        builds: data.map((row) => dto(row, storageData)),
        nextOffset: data.length === 100 ? offset + 100 : null,
      });
    } catch {
      return unavailable(res);
    }
  });
  router.post("/", async (req, res) => {
    if (!UUID.test(req.body?.id ?? ""))
      return res.status(400).json({ error: "INVALID_BUILD" });
    try {
      const catalog =
        typeof req.body?.carId === "string" &&
        req.body.carId.startsWith("storage-car:")
          ? await storage.get(true)
          : assets();
      const value = payload(req.body, catalog);
      if (!value)
        return res.status(400).json({
          error: "INVALID_BUILD",
          message: "ชื่อ รถ หรือรายการพาร์ทไม่ถูกต้อง กรุณาเลือกใหม่",
        });
      const { data, error } = await query()
        .insert({
          id: req.body.id,
          user_id: req.authUser.id,
          ...value,
          category: value.category ?? 'Street',
          is_public: false,
          is_deleted: false,
        })
        .select(columns)
        .single();
      if (error?.code === "23505") {
        // Retry of a timed-out create: never overwrite a row belonging to someone else.
        const existing = await query()
          .select(columns)
          .eq("id", req.body.id)
          .eq("user_id", req.authUser.id)
          .eq("is_deleted", false)
          .maybeSingle();
        if (existing.error) return unavailable(res);
        if (
          existing.data &&
          existing.data.title === value.title &&
          existing.data.category === (value.category ?? 'Street') &&
          existing.data.tag === value.tag &&
          JSON.stringify(existing.data.parts) === JSON.stringify(value.parts)
        )
          return res.json({ build: dto(existing.data, catalog) });
        return res.status(409).json({
          error: "BUILD_CONFLICT",
          message: "รายการนี้มีอยู่แล้ว กรุณาโหลดข้อมูลใหม่",
        });
      }
      if (error?.code === "23503")
        return res.status(409).json({
          error: "PROFILE_REQUIRED",
          message: "กรุณาเปิดหน้าโปรไฟล์ให้โหลดสำเร็จแล้วลองบันทึกอีกครั้ง",
        });
      if (error) return unavailable(res);
      return res.status(201).json({ build: dto(data, catalog) });
    } catch {
      return unavailable(res);
    }
  });
  router.put("/:id", async (req, res) => {
    if (!UUID.test(req.params.id))
      return res.status(400).json({ error: "INVALID_BUILD" });
    try {
      const catalog =
        typeof req.body?.carId === "string" &&
        req.body.carId.startsWith("storage-car:")
          ? await storage.get(true)
          : assets();
      const value = payload(req.body, catalog);
      if (!value)
        return res.status(400).json({
          error: "INVALID_BUILD",
          message: "ชื่อ รถ หรือรายการพาร์ทไม่ถูกต้อง กรุณาเลือกใหม่",
        });
      const { data, error } = await query()
        .update({ ...value, updated_at: now() })
        .eq("id", req.params.id)
        .eq("user_id", req.authUser.id)
        .eq("is_deleted", false)
        .select(columns)
        .maybeSingle();
      if (error) return unavailable(res);
      if (!data)
        return res
          .status(404)
          .json({ error: "BUILD_NOT_FOUND", message: "ไม่พบ Build ของคุณ" });
      return res.json({ build: dto(data, catalog) });
    } catch {
      return unavailable(res);
    }
  });
  router.patch("/:id/visibility", async (req, res) => {
    if (!UUID.test(req.params.id) || typeof req.body?.isPublic !== "boolean")
      return res
        .status(400)
        .json({
          error: "INVALID_VISIBILITY",
          message: "สถานะการเผยแพร่ไม่ถูกต้อง",
        });
    try {
      const { data, error } = await query()
        .update({ is_public: req.body.isPublic, updated_at: now() })
        .eq("id", req.params.id)
        .eq("user_id", req.authUser.id)
        .eq("is_deleted", false)
        .select("id,is_public,updated_at")
        .maybeSingle();
      if (error) return unavailable(res);
      if (!data)
        return res
          .status(404)
          .json({ error: "BUILD_NOT_FOUND", message: "ไม่พบ Build ของคุณ" });
      return res.json({
        visibility: {
          id: data.id,
          isPublic: data.is_public,
          updatedAt: data.updated_at,
        },
      });
    } catch {
      return unavailable(res);
    }
  });
  router.delete("/:id", async (req, res) => {
    if (!UUID.test(req.params.id))
      return res.status(400).json({ error: "INVALID_BUILD" });
    try {
      const { data, error } = await query()
        .update({ is_deleted: true, updated_at: now() })
        .eq("id", req.params.id)
        .eq("user_id", req.authUser.id)
        .select("id")
        .maybeSingle();
      if (error) return unavailable(res);
      if (!data)
        return res
          .status(404)
          .json({ error: "BUILD_NOT_FOUND", message: "ไม่พบ Build ของคุณ" });
      return res.status(204).end();
    } catch {
      return unavailable(res);
    }
  });
  return router;
}
module.exports = { buildsRoutes, payload };
