const { readFile, writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { combineBrands, toCsv, toSql } = require("./lib/car-brands");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "data/reference");
const raw = path.join(output, "raw");
const github = "https://api.github.com/repos/filippofilip95/car-logos-dataset";
const registry = [
  {
    id: "nhtsa-passenger-car",
    filename: "nhtsa-passenger-car.json",
    vehicleTypeId: 2,
    url: "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car?format=json",
  },
  {
    id: "nhtsa-mpv",
    filename: "nhtsa-mpv.json",
    vehicleTypeId: 7,
    url: "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/Multipurpose%20Passenger%20Vehicle?format=json",
  },
];
const hash = (body) => createHash("sha256").update(body).digest("hex");
async function download(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Performante-Lab-Reference-Collector",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(`Source returned HTTP ${response.status}: ${url}`);
  return response.text();
}
async function main() {
  await mkdir(raw, { recursive: true });
  let manifest;
  if (!process.argv.includes("--offline")) {
    const commit = JSON.parse(await download(github + "/commits/master"));
    if (!/^[0-9a-f]{40}$/.test(commit.sha))
      throw new Error("Invalid source revision");
    const base = `https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/${commit.sha}`;
    const requests = [
      {
        id: "car-logos-dataset",
        filename: "car-logos.json",
        url: base + "/logos/data.json",
      },
      {
        id: "car-logos-readme",
        filename: "car-logos-README.md",
        url: base + "/README.md",
      },
      ...registry,
    ];
    const bodies = await Promise.all(
      requests.map(async (request) => ({
        ...request,
        body: await download(request.url),
      })),
    );
    // Check every response before replacing any snapshot.
    for (const item of bodies)
      if (item.filename.endsWith(".json")) JSON.parse(item.body);
    manifest = {
      schemaVersion: 1,
      retrievedAt: new Date().toISOString(),
      logoDatasetRevision: commit.sha,
      sources: bodies.map(({ body, ...source }) => ({
        ...source,
        sha256: hash(body),
      })),
    };
    for (const item of bodies)
      await writeFile(path.join(raw, item.filename), item.body);
    await writeFile(
      path.join(raw, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  } else {
    manifest = JSON.parse(
      await readFile(path.join(raw, "manifest.json"), "utf8"),
    );
    for (const source of manifest.sources)
      if (
        hash(await readFile(path.join(raw, source.filename))) !== source.sha256
      )
        throw new Error("Snapshot checksum mismatch: " + source.filename);
  }
  const logos = JSON.parse(
    await readFile(path.join(raw, "car-logos.json"), "utf8"),
  );
  const registered = await Promise.all(
    registry.map(async (source) => ({
      ...source,
      data: JSON.parse(await readFile(path.join(raw, source.filename), "utf8")),
    })),
  );
  const supplement = await readFile(
    path.join(output, "official-additions.json"),
    "utf8",
  );
  const additions = JSON.parse(supplement);
  const candidates = combineBrands(
    logos,
    registered,
    manifest.logoDatasetRevision,
    additions,
  );
  const starterIds = JSON.parse(
    await readFile(path.join(output, "starter-brand-ids.json"), "utf8"),
  );
  const starterBrands = starterIds
    .map((id) => {
      const brand = candidates.find((item) => item.id === id);
      if (!brand) throw new Error("Unknown starter brand: " + id);
      return brand;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  // This allowlist is the active dataset, not a second subset of a global catalog.
  const brands = starterBrands.map((brand) => ({
    ...brand,
    ...(brand.id === "great-wall" ? { name: "GWM", aliases: [...new Set([...brand.aliases, "Great Wall", "Great Wall Motor"])] } : {}),
    parentBrandId: ["haval", "ora"].includes(brand.id) ? "great-wall" : null,
  }));
  if (
    new Set(brands.map((brand) => brand.id)).size !== brands.length ||
    new Set(brands.map((brand) => brand.slug)).size !== brands.length
  )
    throw new Error("Duplicate ID/slug requires manual resolution");
  const dataset = {
    schemaVersion: 1,
    collectedAt: manifest.retrievedAt,
    scope:
      "Project selection: 28 Thai-market, Chinese and enthusiast brands. Editorial project scope, not a sales ranking or a list of buildable models.",
    counts: {
      total: brands.length,
      vehicleRegistryMatched: brands.filter(
        (brand) => brand.nhtsaMakeIds.length,
      ).length,
      sourceOnly: brands.filter((brand) => !brand.nhtsaMakeIds.length).length,
      logoReferences: brands.filter((brand) => brand.logoReferenceUrl).length,
    },
    sources: manifest.sources,
    supplement: {
      filename: "official-additions.json",
      count: additions.length,
      sha256: hash(supplement),
    },
    brands,
  };
  dataset.counts.officialSupplement = additions.length;
  dataset.counts.starterSelection = starterBrands.length;
  await writeFile(
    path.join(output, "car-brands.json"),
    JSON.stringify(dataset, null, 2) + "\n",
  );
  await writeFile(
    path.join(output, "car-brands-starter.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        collectedAt: manifest.retrievedAt,
        scope:
          "Editorial starting selection for catalog planning, not a list of supported models or proof of current operation.",
        count: starterBrands.length,
        brands,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    path.join(output, "car-brands.csv"),
    "\uFEFF" + toCsv(brands),
  );
  await mkdir(path.join(root, "supabase/seeds"), { recursive: true });
  await writeFile(
    path.join(root, "supabase/seeds/car-brand-reference.sql"),
    toSql(brands, manifest.retrievedAt),
  );
  console.log(
    JSON.stringify(
      {
        collectedAt: manifest.retrievedAt,
        counts: dataset.counts,
        rawCounts: {
          logos: logos.length,
          ...Object.fromEntries(
            registered.map((source) => [source.id, source.data.Results.length]),
          ),
        },
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
