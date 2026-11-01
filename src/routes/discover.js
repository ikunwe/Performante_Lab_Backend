const { Router } = require("express");
const { requireAuth } = require("../middleware/require-auth");
const { requireActive } = require("../middleware/require-role");
const { createStorageCatalog } = require("../services/storage-catalog");
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
      let query = admin
        .from("builds")
        .select(
          "id,user_id,title,car_name,tag,image_url,parts,budget,category,likes,is_public,created_at",
        )
        .eq("is_deleted", false);
      // Service client bypasses RLS: visibility must be enforced here, never by the UI.
      query = owner
        ? query.or(`is_public.eq.true,user_id.eq.${owner}`)
        : query.eq("is_public", true);
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + 99);
      if (error || !Array.isArray(data)) throw new Error("database");
      const authors = new Map();
      if (data.length) {
        const profiles = await admin
          .from("profiles")
          .select("id,username")
          .in("id", [...new Set(data.map((row) => row.user_id))]);
        if (profiles.error) throw new Error("profiles");
        for (const profile of profiles.data || [])
          authors.set(profile.id, profile.username || "สมาชิก");
      }
      let catalog;
      if (
        data.some(
          (row) =>
            row.tag.startsWith("storage-car:") ||
            row.parts.some(
              (id) => typeof id === "string" && id.startsWith("storage-part:"),
            ),
        )
      ) {
        // Stored build covers still work when optional product-name lookup is unavailable.
        try {
          catalog = await storage.get();
        } catch {
          /* Keep recorded build data. */
        }
      }
      const products = new Map(
        (catalog?.parts || []).map((part) => [part.id, part]),
      );
      const builds = data.map((row) => ({
        id: row.id,
        title: row.title,
        author: authors.get(row.user_id) || "สมาชิก",
        car: row.car_name,
        carId: row.tag,
        category: row.category,
        image:
          catalog?.cars.find((car) => car.id === row.tag)?.image ||
          row.image_url,
        budget: Number(row.budget),
        likes: row.likes,
        isOwn: row.user_id === owner,
        isPublic: row.is_public,
        createdAt: row.created_at,
        parts: row.parts
          .filter((id) => typeof id === "string")
          .map(
            (id) =>
              products.get(id)?.name ||
              (/^(storage-part:|local-part:)/.test(id)
                ? "พาร์ทที่ไม่มีในแค็ตตาล็อกปัจจุบัน"
                : id),
          ),
      }));
      return res.json({
        builds,
        nextOffset:
          data.length === 100 && offset + 100 <= 10000 ? offset + 100 : null,
      });
    } catch {
      return res
        .status(503)
        .json({
          error: "DISCOVER_UNAVAILABLE",
          message: "โหลดรายการ Build ไม่สำเร็จ กรุณาลองใหม่",
        });
    }
  });
  return router;
}
module.exports = { discoverRoutes };
