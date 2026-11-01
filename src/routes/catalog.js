const { createStorageCatalog } = require("../services/storage-catalog");
const { Router } = require("express");

function catalogRoutes(admin) {
  const router = Router();
  const storage = createStorageCatalog({ admin });
  router.get("/storage", async (req, res) => {
    try {
      const data = await storage.get(req.query.refresh === "1");
      res.set("Cache-Control", "no-cache").json(data);
    } catch {
      res
        .status(503)
        .set("Cache-Control", "no-store")
        .json({
          error: "STORAGE_CATALOG_UNAVAILABLE",
          message: "Unable to load catalog from Storage. Please retry.",
        });
    }
  });
  return router;
}
module.exports = { catalogRoutes };
