const brandIds = new Set(
  require("../../data/reference/starter-brand-ids.json"),
);
const TTL = 60 * 60 * 1000;
function createModelCatalog({ admin, now = Date.now, ttlMs = TTL }) {
  const cache = new Map();
  const pending = new Map();
  const retryAt = new Map();
  async function refresh(brandId) {
    if (!admin) throw new Error("CATALOG_NOT_CONFIGURED");
    const { data, error } = await admin
      .from("car_brand_reference")
      .select("id,name,modelCatalog:details->modelCatalog")
      .eq("id", brandId)
      .single()
      .abortSignal(AbortSignal.timeout(15000));
    const catalog = data?.modelCatalog;
    if (
      error ||
      !catalog ||
      catalog.schemaVersion !== 2 ||
      catalog.brandId !== brandId ||
      !Array.isArray(catalog.models) ||
      !catalog.models.length
    )
      throw new Error("MODELS_UNAVAILABLE");
    const fetchedAt = now();
    const result = {
      ...catalog,
      fetchedAt: new Date(fetchedAt).toISOString(),
      expiresAt: new Date(fetchedAt + ttlMs).toISOString(),
      stale: false,
    };
    cache.set(brandId, result);
    retryAt.delete(brandId);
    return result;
  }
  async function get(brandId) {
    if (!brandIds.has(brandId)) throw new Error("INVALID_BRAND");
    const cached = cache.get(brandId);
    if (cached && Date.parse(cached.expiresAt) > now()) return cached;
    if (cached && (retryAt.get(brandId) || 0) > now())
      return { ...cached, stale: true };
    let request = pending.get(brandId);
    if (!request) {
      request = refresh(brandId).finally(() => pending.delete(brandId));
      pending.set(brandId, request);
    }
    try {
      return await request;
    } catch (error) {
      if (!cached) throw error;
      retryAt.set(brandId, now() + 30000);
      return { ...cached, stale: true };
    }
  }
  return { get };
}
module.exports = { createModelCatalog };
