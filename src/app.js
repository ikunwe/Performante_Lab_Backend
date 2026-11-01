const express = require("express");
const cors = require("cors");
const { authRoutes } = require("./routes/auth");
const { catalogRoutes } = require("./routes/catalog");
const { buildsRoutes } = require('./routes/builds');
const { adminRoutes } = require("./routes/admin");
const { discoverRoutes } = require('./routes/discover');
const { requireAuth } = require("./middleware/require-auth");
const {
  requireAdmin,
  requireSuperAdmin,
} = require("./middleware/require-role");

function createApp({
  supabase,
  admin,
  createAuthClient,
  origins = [],
  routes,
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4kb" }));
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, !origin || origins.includes(origin)),
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE",  "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
    }),
  );
  app.get("/api/health", (_req, res) =>
    res.json({ status: "ok", authConfigured: !!supabase }),
  );
  app.use("/api/auth", authRoutes(supabase, { admin, createAuthClient }));
  app.use("/api/catalog", catalogRoutes(admin));
  app.use('/api/builds', buildsRoutes(supabase, { admin }));
  app.use('/api/discover', discoverRoutes(supabase, { admin }));
  // Guard extension routes before mounting them; catalog remains public.
  app.use(
    "/api/admin",
    requireAuth(supabase),
    requireAdmin(supabase, { admin }),
  );
  app.use(
    "/api/super-admin",
    requireAuth(supabase),
    requireSuperAdmin(supabase, { admin }),
  );
  app.use("/api/admin", adminRoutes({ admin, supabase }));
  if (typeof routes === "function") {
    routes(app, { supabase, admin });
  } else if (Array.isArray(routes)) {
    for (const r of routes) {
      if (r && r.path && r.handler) {
        app.use(r.path, r.handler);
      }
    }
  }
  app.use((_req, res) => res.status(404).json({ error: "NOT_FOUND" }));
  app.use((error, _req, res, _next) => {
    const invalidBody =
      error.type === "entity.parse.failed" || error.type === "entity.too.large";
    res
      .status(invalidBody ? 400 : 500)
      .json({ error: invalidBody ? "INVALID_REQUEST" : "INTERNAL_ERROR" });
  });
  return app;
}

module.exports = { createApp };
