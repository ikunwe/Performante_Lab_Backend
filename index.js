require("dotenv").config({ quiet: true });
const { createApp } = require("./src/app");
const { createSupabase, createAdmin } = require("./src/config/supabase");

const port = Number(process.env.PORT || 3000);
const app = createApp({
  supabase: createSupabase(process.env),
  admin: createAdmin(process.env),
  createAuthClient: () => createSupabase(process.env),
  origins: (process.env.FRONTEND_ORIGINS || "http://localhost:4200")
    .split(",")
    .map((origin) => origin.trim()),
});

app.listen(port, () =>
  console.log(
    `Performante Lab API running at http://localhost:${port}/api/health`,
  ),
);
