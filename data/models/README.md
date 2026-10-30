# Selected vehicle model names

Active schemaVersion: 2. Contains 28 selected brands and 801 model-name records.
Each model contains only id, brandId, name and sourceUrl. Generation, year,
chassis and engine fields are deliberately omitted per project scope.

Adapted database: ODbL 1.0. Attribution: https://github.com/gor3a/vehicle-makes-models
and https://www.autoevolution.com/. Source revision:
ee99776470a45214bf524cdfe22e5dbf4bd67f93.
Original notices are in raw/LICENSE-DATA and raw/README.md.

Changes: filter to 28 brands, remove engine/generation/year/chassis information,
map GAC Aion model names to AION and supplement factual model names from official
catalogs in official-models.json. IDs remain stable for existing model references.
The archived chassis-evidence.json is no longer read by the collector.

car-models.json is the complete adapted active snapshot, offered by
/api/catalog/models/export under ODbL 1.0. raw/*.json.gz preserve original
source snapshots for offline reproducibility; they are not served as active data.
Checksums in raw/manifest.json refer to decompressed bytes.

npm run data:models:offline verifies snapshots and regenerates model names only.
npm run data:models refreshes the pinned source. npm run data:models:sync backs up
existing rows in tmp/ then replaces details.modelCatalog for the 28 selected brands,
reading back and comparing every write. The rest of each brand's details is retained.
No tables, accounts or saved user builds are deleted.

Schema 2 has been applied to Supabase. Data with generations was backed up before
replacement. Frontend uses a new cache namespace and selects models directly.
Reference models are global names, not confirmation of Thai sales or part fitment.
