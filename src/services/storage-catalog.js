const { createHash } = require("node:crypto");
const imageFile = (name) => /\.(png|jpe?g|webp|svg|avif)$/i.test(name);
const maskFile = (name) => /\.(mask|layer)\./i.test(name);
const isFolder = (item) => item.id === null;
const label = (name) => name.replace(/[-_]+/g, " ").trim();
const identity = (kind, path) =>
  `storage-${kind}:` +
  createHash("sha256").update(path).digest("hex").slice(0, 32);
function partCategory(name) {
  const text = name.toLowerCase().replace(/[-_]+/g, " ");
  if (/front.*(bumper|lip|splitter)|(bumper|lip|splitter).*front/.test(text))
    return "front";
  if (/rear.*(bumper|diffuser)|(bumper|diffuser).*rear/.test(text))
    return "rear";
  if (/wheel|rim|rpf1|nt03/.test(text)) return "wheels";
  if (/spoiler|wing/.test(text)) return "spoilers";
  if (/brake|caliper|rotor/.test(text)) return "brakes";
  if (/exhaust|titanium|slip.?on|muffler/.test(text)) return "exhaust";
  if (/suspension|coilover|spring|damper/.test(text)) return "suspension";
  return "others";
}
async function parallel(items, fn) {
  const result = new Array(items.length);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(items.length, 6) }, async () => {
      while (index < items.length) {
        const i = index++;
        result[i] = await fn(items[i]);
      }
    }),
  );
  return result;
}
function createStorageCatalog({ admin, now = Date.now, ttlMs = 60000 }) {
  let cached, pending;
  async function scan() {
    if (!admin?.storage) throw new Error("STORAGE_NOT_CONFIGURED");
    const bucket = admin.storage.from("catalog");
    let active = 0;
    const waiting = [];
    async function withSlot(action) {
      if (active >= 6) await new Promise((resolve) => waiting.push(resolve));
      else active++;
      try {
        return await action();
      } finally {
        const next = waiting.shift();
        if (next) next();
        else active--;
      }
    }
    async function list(path) {
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await withSlot(() =>
          bucket.list(path, {
            limit: 1000,
            offset,
            sortBy: { column: "name", order: "asc" },
          }),
        );
        if (error || !Array.isArray(data))
          throw new Error("STORAGE_UNAVAILABLE");
        rows.push(...data.filter((item) => !item.name.startsWith(".")));
        if (data.length < 1000) return rows;
        if (offset >= 99000) throw new Error("STORAGE_TOO_LARGE");
      }
    }
    function url(path, file) {
      const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
      const version = file.updated_at || file.created_at;
      return version
        ? publicUrl + "?v=" + encodeURIComponent(version)
        : publicUrl;
    }
    const angles = {
      "45_front": "front45",
      front: "front",
      side: "side",
      "45_back": "rear45",
      back: "rear",
    };
    function views(files, path, mode = '') {
      return Object.fromEntries(
        files
          .filter((f) => !isFolder(f) && imageFile(f.name) && (mode ? f.name.toLowerCase().endsWith('.'+mode+'.png') : !maskFile(f.name)))
          .flatMap((f) => {
            const angle = angles[f.name.replace(mode ? new RegExp('\\.'+mode+'\\.png$','i') : /\.[^.]+$/, "").toLowerCase()];
            return angle ? [[angle, url(path + "/" + f.name, f)]] : [];
          }),
      );
    }
    const pickView = (images, category) =>
      (category === "rear" || category === "spoilers"
        ? images.rear45 || images.rear || images.front45 || images.front
        : images.front45 || images.front || images.rear45 || images.rear) ||
      images.side;
    async function workshopParts(workshopPath, manufacturer, carId, category) {
      const items = await list(workshopPath);
      const logo = items.find(
        (f) => !isFolder(f) && /^logo\./i.test(f.name) && imageFile(f.name),
      );
      const manufacturerLogo = logo
        ? url(workshopPath + "/" + logo.name, logo)
        : null;
      const makePart = (path, name, previewImage, images) => ({
        id: identity("part", path),
        storagePath: path,
        carId,
        category: category || partCategory(name),
        name: label(name),
        finish: label(manufacturer),
        manufacturerLogo,
        previewImage,
        ...(images ? { views: images } : {}),
        crop: "full",
        description: "",
      });
      const flat = items
        .filter(
          (f) => !isFolder(f) && imageFile(f.name) && !maskFile(f.name) && !/^logo\./i.test(f.name),
        )
        .map((f) =>
          makePart(
            workshopPath + "/" + f.name,
            f.name.replace(/\.[^.]+$/, ""),
            url(workshopPath + "/" + f.name, f),
          ),
        );
      const nested = await parallel(items.filter(isFolder), async (item) => {
        const path = workshopPath + "/" + item.name;
        const files = await list(path);
        const images = views(files, path);
        const preview =
          pickView(images, category) ||
          (() => {
            const f = files.find(
              (f) =>
                !isFolder(f) && imageFile(f.name) && !maskFile(f.name) && !/^logo\./i.test(f.name),
            );
            return f ? url(path + "/" + f.name, f) : null;
          })();
        if (!preview) return null;
        const masks = views(files, path, 'mask');
        const layerViews = views(files, path, 'layer');
        // The editor writes the aligned frame first and its mask last. Never mix
        // a newly written frame with an older mask after an interrupted save.
        for (const [filename, angle] of Object.entries(angles)) {
          const photo = files.find(f => f.name.toLowerCase() === filename + '.layer.png');
          const mask = files.find(f => f.name.toLowerCase() === filename + '.mask.png');
          if (photo && mask && Date.parse(photo.updated_at || photo.created_at) > Date.parse(mask.updated_at || mask.created_at)) delete masks[angle];
        }
        return { ...makePart(path, item.name, preview, images), masks, layerViews };
      });
      return [...flat, ...nested.filter(Boolean)];
    }
    const roots = (await list("")).filter(isFolder);
    const groups = await parallel(roots, async (root) => {
      const files = await list(root.name);
      const logo = files.find(
        (f) =>
          !isFolder(f) && /^logo\.(png|jpe?g|svg|webp|avif)$/i.test(f.name),
      );
      const models = await parallel(files.filter(isFolder), async (model) => {
        const path = root.name + "/" + model.name;
        const modelFiles = await list(path);
        const images = views(modelFiles, path);
        const picture = modelFiles.find(
          (f) =>
            !isFolder(f) &&
            /^CarPicture\.(png|jpe?g|webp|svg|avif)$/i.test(f.name),
        );
        const cover =
          pickView(images) ||
          (picture ? url(path + "/" + picture.name, picture) : null);
        // Ignore unrelated upload namespaces without a recognized car image.
        if (!cover) return null;
        const car = {
          id: identity("car", path),
          storagePath: path,
          brand: label(root.name),
          name: label(root.name) + " " + label(model.name),
          modelName: label(model.name),
          image: cover,
          views: images,
          body: "",
        };
        const parts = [];
        for (const type of ["BodyKit", "Part"]) {
          if (!modelFiles.some((f) => isFolder(f) && f.name === type)) continue;
          const typePath = path + "/" + type;
          const children = (await list(typePath)).filter(isFolder);
          const collections = await parallel(children, async (child) => {
            const childPath = typePath + "/" + child.name;
            const category =
              type === "BodyKit" ? "bodykits" : partCategory(child.name);
            // New Admin Part/{Category}/{Manufacturer}/{Product}/{angle} layout.
            if (type === "Part" && category !== "others") {
              const workshops = (await list(childPath)).filter(isFolder);
              const products = await parallel(workshops, (workshop) =>
                workshopParts(
                  childPath + "/" + workshop.name,
                  workshop.name,
                  car.id,
                  category,
                ),
              );
              return products.flat();
            }
            // Original flat files and BodyKit/{Manufacturer}/{Kit}/{angle} layout.
            return workshopParts(
              childPath,
              child.name,
              car.id,
              type === "BodyKit" ? "bodykits" : undefined,
            );
          });
          parts.push(...collections.flat());
        }
        return { car, parts };
      });
      const valid = models.filter(Boolean);
      if (!logo && !valid.length) return null;
      return {
        brand: {
          id: root.name,
          name: label(root.name),
          slug: root.name,
          aliases: [],
          logoUrl: logo ? url(root.name + "/" + logo.name, logo) : null,
        },
        models: valid,
      };
    });
    const valid = groups.filter(Boolean);
    const models = valid.flatMap((group) => group.models);
    const fetched = now();
    return {
      schemaVersion: 1,
      source: "storage",
      brands: valid.map((group) => group.brand),
      cars: models.map((model) => model.car),
      parts: models.flatMap((model) => model.parts),
      fetchedAt: new Date(fetched).toISOString(),
      expiresAt: new Date(fetched + ttlMs).toISOString(),
    };
  }
  async function get(force = false) {
    if (!force && cached && Date.parse(cached.expiresAt) > now()) return cached;
    if (!pending)
      pending = scan()
        .then((result) => {
          cached = result;
          return result;
        })
        .finally(() => {
          pending = null;
        });
    return pending;
  }
  return { get };
}
module.exports = { createStorageCatalog, partCategory, identity };
