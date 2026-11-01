const showcaseColumns =
  "id,user_id,title,car_name,tag,image_url,parts,budget,category,likes,is_public,created_at";
async function showcaseBuilds(admin, storage, data, owner) {
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
        (typeof row.tag === "string" && row.tag.startsWith("storage-car:")) ||
        (Array.isArray(row.parts) ? row.parts : []).some(
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
    title: row.title || "Untitled Build",
    author: authors.get(row.user_id) || "สมาชิก",
    car: row.car_name || "ยังไม่ระบุรุ่นรถ",
    carId: row.tag,
    partIds: (Array.isArray(row.parts) ? row.parts : []).filter(
      (id) => typeof id === "string",
    ),
    category: row.category || "Street",
    image:
      catalog?.cars.find((car) => car.id === row.tag)?.image ||
      row.image_url ||
      "",
    budget: Number(row.budget),
    likes: Number(row.likes) || 0,
    isOwn: row.user_id === owner,
    isPublic: row.is_public,
    createdAt: row.created_at,
    partDetails: (Array.isArray(row.parts) ? row.parts : [])
      .filter((id) => typeof id === "string")
      .map((id) => ({
        id,
        name:
          products.get(id)?.name ||
          (/^(storage-part:|local-part:)/.test(id)
            ? "พาร์ทที่ไม่มีในแค็ตตาล็อกปัจจุบัน"
            : id),
        category: products.get(id)?.category || null,
      })),
    parts: (Array.isArray(row.parts) ? row.parts : [])
      .filter((id) => typeof id === "string")
      .map(
        (id) =>
          products.get(id)?.name ||
          (/^(storage-part:|local-part:)/.test(id)
            ? "พาร์ทที่ไม่มีในแค็ตตาล็อกปัจจุบัน"
            : id),
      ),
  }));
  return builds;
}
module.exports = { showcaseBuilds, showcaseColumns };
