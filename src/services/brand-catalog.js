const starterIds = new Set(
  require("../../data/reference/starter-brand-ids.json"),
);
const BRAND_CACHE_TTL_MS = 60 * 60 * 1000;

function createBrandCatalog({
  admin,
  now = Date.now,
  ttlMs = BRAND_CACHE_TTL_MS,
}) {
  let snapshot = null;
  let pending = null;
  let retryAt = 0;

  async function fetchBrands() {
    if (!admin) throw new Error("CATALOG_NOT_CONFIGURED");
    const records = [];
    for (let offset = 0; offset < 10000; offset += 1000) {
      const { data, error } = await admin
        .from("car_brand_reference")
        .select("id,slug,name,aliases:details->aliases,logoReferenceUrl:details->logoReferenceUrl")
        .order("id")
        .range(offset, offset + 999)
        .abortSignal(AbortSignal.timeout(15000));
      if (error || !Array.isArray(data)) throw new Error("CATALOG_UNAVAILABLE");
      records.push(...data);
      if (data.length < 1000) {
        const ids = new Set();
        const brands = records.filter((row) => starterIds.has(row.id))
          .map((row) => {
            if (!row.id || !row.name || !row.slug || ids.has(row.id))
              throw new Error("CATALOG_INVALID");
            ids.add(row.id);
            const logo = row.logoReferenceUrl ?? row.details?.logoReferenceUrl;
            const aliases = row.aliases ?? row.details?.aliases;
            return {
              id: row.id,
              slug: row.slug,
              name: row.id === "great-wall" ? "GWM" : row.name,
              aliases: Array.isArray(aliases)
                ? aliases.filter(
                    (value) => typeof value === "string",
                  )
                : [],
              logoUrl:
                typeof logo === "string" &&
                logo.startsWith(
                  "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/",
                )
                  ? logo
                  : null,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name, "en"));
        if (!brands.length) throw new Error("CATALOG_EMPTY");
        const fetchedAt = now();
        snapshot = { brands, fetchedAt, expiresAt: fetchedAt + ttlMs };
        return snapshot;
      }
    }
    throw new Error("CATALOG_TOO_LARGE");
  }

  async function get(scope = "starter") {
    let stale = false;
    if (snapshot && snapshot.expiresAt <= now() && now() < retryAt)
      stale = true;
    else if (!snapshot || snapshot.expiresAt <= now()) {
      if (!pending) {
        pending = fetchBrands().finally(() => {
          pending = null;
        });
      }
      try {
        await pending;
        retryAt = 0;
      } catch (error) {
        if (!snapshot) throw error;
        retryAt = now() + 30000;
        stale = true;
      }
    }
    const brands =
      scope === "all"
        ? snapshot.brands
        : snapshot.brands.filter((brand) => starterIds.has(brand.id));
    return {
      schemaVersion: 1,
      source: "supabase",
      scope,
      brands,
      stale,
      fetchedAt: new Date(snapshot.fetchedAt).toISOString(),
      expiresAt: new Date(snapshot.expiresAt).toISOString(),
    };
  }
  return { get };
}

module.exports = { createBrandCatalog, BRAND_CACHE_TTL_MS };
