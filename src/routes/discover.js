const { Router } = require("express");
const { requireAuth } = require("../middleware/require-auth");
const { requireActive } = require("../middleware/require-role");
const { createStorageCatalog } = require("../services/storage-catalog");
const { showcaseBuilds } = require("../services/showcase-builds");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function discoverRoutes(supabase, { admin } = {}) {
  const router = Router();
  const authenticate = requireAuth(supabase),
    active = requireActive(supabase, { admin });
  const storage = createStorageCatalog({ admin });
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!req.get("authorization")) return next();
    return authenticate(req, res, () => active(req, res, next));
  });
  router.get("/builds", async (req, res) => {
    const offset =
      req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
      return res.status(400).json({ error: "INVALID_PAGE" });
    try {
      if (!admin) throw new Error("not configured");
      const owner = req.authUser?.id ?? null;
      if (owner && !UUID.test(owner)) throw new Error("invalid identity");
      const query = admin
        .from("builds")
        .select(
          "id,user_id,title,car_name,tag,image_url,parts,budget,category,likes,is_public,created_at",
        )
        .eq("is_deleted", false)
        .eq("is_public", true);
      // Discover is public-only, including records owned by the current viewer.
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + 99);
      if (error || !Array.isArray(data)) throw new Error("database");
      const builds = await showcaseBuilds(admin, storage, data, owner);
      return res.json({
        builds,
        nextOffset:
          data.length === 100 && offset + 100 <= 10000 ? offset + 100 : null,
      });
    } catch {
      return res.status(503).json({
        error: "DISCOVER_UNAVAILABLE",
        message: "โหลดรายการ Build ไม่สำเร็จ กรุณาลองใหม่",
      });
    }
  });
  return router;
}
module.exports = { discoverRoutes };
