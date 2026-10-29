const express = require("express");
const cors = require("cors");
const { authRoutes } = require("./routes/auth");

function createApp({ supabase, admin, createAuthClient, origins = [] }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4kb" }));
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, !origin || origins.includes(origin)),
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
    }),
  );
  app.get("/api/health", (_req, res) =>
    res.json({ status: "ok", authConfigured: !!supabase }),
  );
  app.use("/api/auth", authRoutes(supabase, { admin, createAuthClient }));
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
