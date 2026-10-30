const aliases = new Map([
  ["mercedesbenz", "mercedesbenz"],
  ["mercedes", "mercedesbenz"],
  ["vw", "volkswagen"],
  ["mgmotor", "mg"],
  ["bydauto", "byd"],
  ["dsautomobiles", "ds"],
  ["rollsroycemotorcars", "rollsroyce"],
]);

function identity(name) {
  const key = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return aliases.get(key) || key;
}

function combineBrands(logos, registrySources, revision, additions = []) {
  if (!Array.isArray(logos) || !logos.length)
    throw new Error("Empty logo metadata");
  const records = new Map();
  const ensure = (name, id, slug) => {
    const key = identity(name);
    if (!key) throw new Error("Invalid brand name");
    if (!records.has(key))
      records.set(key, {
        id,
        slug,
        name: name.trim(),
        aliases: [],
        nhtsaMakeIds: [],
        vehicleTypes: [],
        logoReferenceUrl: null,
        logoOriginalSourceUrl: null,
        country: null,
        operatingStatus: "unknown",
        reviewStatus: "source_only",
        isBuildReady: false,
        sources: [],
      });
    const record = records.get(key);
    if (name.trim() !== record.name && !record.aliases.includes(name.trim()))
      record.aliases.push(name.trim());
    return record;
  };
  for (const item of logos) {
    if (typeof item.name !== "string" || !/^[a-z0-9-]+$/.test(item.slug))
      throw new Error("Invalid logo record");
    const record = ensure(item.name, item.slug, item.slug);
    record.sources.push({
      sourceId: "car-logos-dataset",
      sourceName: item.name,
      sourceSlug: item.slug,
    });
    if (!record.logoReferenceUrl && item.image?.optimized) {
      record.logoReferenceUrl = item.image.optimized.replace(
        "/master/",
        `/${revision}/`,
      );
      record.logoOriginalSourceUrl = item.image.source || null;
    }
  }
  for (const item of additions) {
    const record = ensure(item.name, item.id, item.id);
    record.sources.push({
      sourceId: "official-supplement",
      url: item.url,
      verifiedAt: item.verifiedAt,
    });
    record.reviewStatus = "official_brand_page";
  }
  for (const source of registrySources) {
    if (!Array.isArray(source.data.Results) || !source.data.Results.length)
      throw new Error("Empty vehicle registry response");
    for (const item of source.data.Results) {
      if (
        !Number.isInteger(item.MakeId) ||
        typeof item.MakeName !== "string" ||
        item.VehicleTypeId !== source.vehicleTypeId
      )
        throw new Error("Invalid registry record");
      const slug = "vpic-make-" + item.MakeId;
      const record = ensure(item.MakeName, slug, slug);
      if (!record.nhtsaMakeIds.includes(item.MakeId))
        record.nhtsaMakeIds.push(item.MakeId);
      if (!record.vehicleTypes.some((type) => type.id === item.VehicleTypeId))
        record.vehicleTypes.push({
          id: item.VehicleTypeId,
          name: item.VehicleTypeName,
        });
      if (
        !record.sources.some(
          (entry) =>
            entry.sourceId === source.id && entry.makeId === item.MakeId,
        )
      )
        record.sources.push({
          sourceId: source.id,
          makeId: item.MakeId,
          sourceName: item.MakeName,
        });
      record.reviewStatus = "vehicle_registry_match";
    }
  }
  return [...records.values()]
    .map((record) => ({
      ...record,
      aliases: record.aliases.sort(),
      nhtsaMakeIds: record.nhtsaMakeIds.sort((a, b) => a - b),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function toCsv(brands) {
  const fields = [
    "id",
    "slug",
    "name",
    "aliases",
    "nhtsaMakeIds",
    "vehicleTypes",
    "reviewStatus",
    "isBuildReady",
    "logoReferenceUrl",
  ];
  const cell = (value) =>
    '"' +
    String(
      Array.isArray(value) ? JSON.stringify(value) : (value ?? ""),
    ).replaceAll('"', '""') +
    '"';
  return (
    fields.join(",") +
    "\n" +
    brands
      .map((row) => fields.map((field) => cell(row[field])).join(","))
      .join("\n") +
    "\n"
  );
}

function toSql(brands, collectedAt) {
  const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
  return (
    `-- Reference data only. Does not enable brands for Create Build or add models/parts.\nbegin;\ncreate table if not exists public.car_brand_reference (\n  id text primary key, slug text unique not null, name text not null,\n  details jsonb not null, collected_at timestamptz not null\n);\nalter table public.car_brand_reference enable row level security;\nrevoke all on public.car_brand_reference from anon, authenticated;\ngrant all on public.car_brand_reference to service_role;\n\n` +
    brands
      .map(
        (brand) =>
          `insert into public.car_brand_reference(id, slug, name, details, collected_at) values (${literal(brand.id)}, ${literal(brand.slug)}, ${literal(brand.name)}, ${literal(JSON.stringify(brand))}::jsonb, ${literal(collectedAt)}) on conflict (id) do update set slug = excluded.slug, name = excluded.name, details = public.car_brand_reference.details || excluded.details, collected_at = excluded.collected_at;`,
      )
      .join("\n") +
    `\n-- Replace only this reference catalog; accounts, models and builds are untouched.\ndelete from public.car_brand_reference where id not in (${brands.map((brand) => literal(brand.id)).join(", ")});\ncommit;\n`
  );
}

module.exports = { identity, combineBrands, toCsv, toSql };
