const { Router } = require("express");
const { createBrandCatalog } = require("../services/brand-catalog");
const { createModelCatalog } = require("../services/model-catalog");
const modelDataset = require("../../data/models/car-models.json");

function catalogRoutes(admin) {
  const router = Router();
  const catalog = createBrandCatalog({ admin });
  const models = createModelCatalog({ admin });
  router.get("/models/export", (req, res) => {
    res.set("Cache-Control", "public, max-age=3600");
    res.set(
      "Content-Disposition",
      'attachment; filename="performante-car-models.json"',
    );
    res.json(modelDataset);
  });
  router.get("/models", async (req, res) => {
    const brandId = req.query.brandId;
    if (typeof brandId !== "string")
      return res.status(400).json({ error: "INVALID_BRAND" });
    try {
      const result = await models.get(brandId);
      res.set(
        "Cache-Control",
        result.stale ? "no-store" : "public, max-age=300",
      );
      return res.json(result);
    } catch (error) {
      res.set("Cache-Control", "no-store");
      return res
        .status(error.message === "INVALID_BRAND" ? 400 : 503)
        .json({
          error:
            error.message === "INVALID_BRAND"
              ? "INVALID_BRAND"
              : "MODELS_UNAVAILABLE",
          message: "โหลดรายการรุ่นรถไม่ได้ กรุณาลองใหม่",
        });
    }
  });
  router.get("/brands", async (req, res) => {
    const scope = req.query.scope || "starter";
    if (!["starter", "all"].includes(scope))
      return res.status(400).json({ error: "INVALID_SCOPE" });
    try {
      const result = await catalog.get(scope);
      res.set(
        "Cache-Control",
        result.stale ? "no-store" : "public, max-age=300",
      );
      return res.json(result);
    } catch (error) {
      res.set("Cache-Control", "no-store");
      return res.status(503).json({
        error:
          error.message === "CATALOG_NOT_CONFIGURED"
            ? "CATALOG_NOT_CONFIGURED"
            : "CATALOG_UNAVAILABLE",
        message: "โหลดรายการยี่ห้อรถไม่ได้ กรุณาลองใหม่",
      });
    }
  });
  return router;
}
module.exports = { catalogRoutes };
