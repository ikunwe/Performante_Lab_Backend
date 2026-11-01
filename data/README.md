# Catalog data

The active User catalog comes from Supabase Storage through
`GET /api/catalog/storage` (`src/services/storage-catalog.js`). Reference-table
listing and export routes have been removed. No reference rows or Storage objects
are deleted by this change.

- `reference/`: retained brand reference data, source snapshots and notices.
- `models/`: retained adapted vehicle-model dataset and its original license.
  `models/car-models.json` is the complete adapted ODbL-1.0 snapshot, including
  attribution. It is also used to resolve historical `ref:` Build IDs.
- `build-assets.json`: generated local-image metadata used for historical Builds.
  Keep synchronized with the frontend while those Builds remain supported.

Collection/sync commands remain manual maintenance tools in `scripts/`; they are
not called when serving the active Storage catalog. Sync commands write reference
tables only when explicitly run. No sync or migration is needed for this change.

Frontend vehicle, brand, part and view image assets remain in place. They are not
automatically uploaded or deleted. Historical Build validation still lives in
`src/services/build-catalog.js`; do not remove that compatibility code with the
retired reference API services.
