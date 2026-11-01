const { Router } = require("express");
const { requireAuth } = require("../middleware/require-auth");
const { requireActive } = require("../middleware/require-role");
const { createStorageCatalog } = require("../services/storage-catalog");
const {
  showcaseBuilds,
  showcaseColumns,
} = require("../services/showcase-builds");
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function unavailable(res) {
  return res.status(503).json({
    error: "LIKES_UNAVAILABLE",
    message: "โหลดหรือบันทึก Like ไม่สำเร็จ กรุณาลองใหม่",
  });
}
async function publicLikeCount(admin, id) {
  const { data, error } = await admin
    .from("builds")
    .select("likes")
    .eq("id", id)
    .eq("is_public", true)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.likes) : 0;
}
function likesRoutes(supabase, { admin }) {
  const router = Router(),
    storage = createStorageCatalog({ admin });
  router.use(requireAuth(supabase), requireActive(supabase, { admin }));
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get("/builds", async (req, res) => {
    const offset =
      req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
      return res.status(400).json({ error: "INVALID_PAGE" });
    try {
      const { data, error } = await admin
        .from("build_likes")
        .select(`build_id,created_at,builds!inner(${showcaseColumns})`)
        .eq("user_id", req.authUser.id)
        .eq("builds.is_public", true)
        .eq("builds.is_deleted", false)
        .order("created_at", { ascending: false })
        .order("build_id", { ascending: false })
        .range(offset, offset + 99);
      if (error || !Array.isArray(data)) return unavailable(res);
      const rows = data.map((row) => row.builds);
      return res.json({
        builds: await showcaseBuilds(admin, storage, rows, req.authUser.id),
        nextOffset:
          data.length === 100 && offset + 100 <= 10000 ? offset + 100 : null,
      });
    } catch {
      return unavailable(res);
    }
  });
  router.put("/:id", async (req, res) => {
    if (!UUID.test(req.params.id))
      return res.status(400).json({ error: "INVALID_BUILD" });
    try {
      const target = await admin
        .from("builds")
        .select("id")
        .eq("id", req.params.id)
        .eq("is_public", true)
        .eq("is_deleted", false)
        .maybeSingle();
      if (target.error) return unavailable(res);
      if (!target.data)
        return res.status(404).json({
          error: "BUILD_NOT_FOUND",
          message: "Build นี้ไม่เป็นสาธารณะหรือถูกลบแล้ว",
        });
      const { error } = await admin
        .from("build_likes")
        .upsert(
          { user_id: req.authUser.id, build_id: req.params.id },
          { onConflict: "user_id,build_id", ignoreDuplicates: true },
        );
      if (error) return unavailable(res);
      return res.json({
        buildId: req.params.id,
        liked: true,
        likes: await publicLikeCount(admin, req.params.id),
      });
    } catch {
      return unavailable(res);
    }
  });
  router.delete("/:id", async (req, res) => {
    if (!UUID.test(req.params.id))
      return res.status(400).json({ error: "INVALID_BUILD" });
    try {
      const { error } = await admin
        .from("build_likes")
        .delete()
        .eq("user_id", req.authUser.id)
        .eq("build_id", req.params.id);
      if (error) return unavailable(res);
      return res.json({
        buildId: req.params.id,
        liked: false,
        likes: await publicLikeCount(admin, req.params.id),
      });
    } catch {
      return unavailable(res);
    }
  });
  return router;
}
module.exports = { likesRoutes };
