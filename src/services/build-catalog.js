const fs = require("node:fs");
const path = require("node:path");
const dataset = require("../../data/models/car-models.json");
const normalize = (value) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const demos = [
  {
    id: "f8-tributo",
    brand: "Ferrari",
    name: "Ferrari F8 Tributo",
    image: "assets/car_pic.png",
    body: "Coupe",
  },
  {
    id: "revuelto",
    brand: "Lamborghini",
    name: "Lamborghini Revuelto",
    image: "assets/car_pic_loginpage.jpg",
    body: "Coupe",
  },
];
const demoCategories = [
  "bodykits",
  "bodykits",
  "bodykits",
  "front",
  "front",
  "rear",
  "rear",
  "wheels",
  "spoilers",
];
function readBuildAssets() {
  // Read the small generated metadata file on demand: the asset watcher updates it.
  return JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../../data/build-assets.json"),
      "utf8",
    ),
  );
}
function resolveCar(id) {
  const demo = demos.find((car) => car.id === id);
  if (demo) return demo;
  for (const brand of dataset.brands) {
    const model = brand.models.find((model) => "ref:" + model.id === id);
    if (model)
      return {
        id,
        brand: brand.brandName,
        name: brand.brandName + " " + model.name,
        image: "",
        body: "ยังไม่มีข้อมูลเจเนอเรชัน",
        reference: {
          brandId: brand.brandId,
          modelId: model.id,
          generationId: null,
          modelName: model.name,
          generationName: null,
          chassisCodes: [],
          yearStart: null,
          yearEnd: null,
          sourceUrl: model.sourceUrl,
        },
      };
  }
  return null;
}
function partsFor(car, assets) {
  if (!car.reference)
    return demoCategories.map((category, index) => ({
      id: car.id + "-" + index,
      category,
    }));
  return assets.parts.filter(
    (part) =>
      part.brandId === car.reference.brandId &&
      part.model === normalize(car.reference.modelName),
  );
}
function coverImage(car, selected, assets) {
  if (!car.reference) return car.image;
  const { brandId, modelName } = car.reference;
  const views = assets.views.filter(
    (view) => view.brandId === brandId && view.model === normalize(modelName),
  );
  const wheel = selected.find((part) => part.category === "wheels");
  const spoiler = selected.find((part) => part.category === "spoilers");
  for (const view of ["front45", "rear45", "rear"]) {
    const bumper = selected.find(
      (part) =>
        part.category === "bodykits" ||
        part.category === (view === "front45" ? "front" : "rear"),
    );
    const variant = bumper ? normalize(bumper.name) : "default";
    const wheelName =
      view !== "rear" && wheel
        ? normalize(wheel.name).replace(/^wheels/, "wheel")
        : undefined;
    const spoilerName = spoiler
      ? normalize(spoiler.name).replace(/^spoilers/, "spoiler")
      : undefined;
    const options = [
      [wheelName, spoilerName],
      [wheelName, undefined],
      [undefined, spoilerName],
      [undefined, undefined],
    ];
    for (const [w, s] of options) {
      if (!bumper && !w && !s) continue;
      const match = views.find(
        (item) =>
          item.view === view &&
          item.variant === variant &&
          item.wheelVariant === w &&
          item.spoilerVariant === s,
      );
      if (match) return match.url;
    }
    if (
      bumper?.url &&
      (bumper.category === "rear" ? view === "rear45" : view === "front45")
    )
      return bumper.url;
  }
  return (
    views.find(
      (view) =>
        view.variant === "default" &&
        !view.wheelVariant &&
        !view.spoilerVariant &&
        view.view === "front45",
    )?.url ??
    assets.cars.find(
      (image) =>
        image.brandId === brandId && image.model === normalize(modelName),
    )?.url ??
    ""
  );
}
module.exports = { readBuildAssets, resolveCar, partsFor, coverImage };
