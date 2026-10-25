import { defineConfig } from "drizzle-kit";

// Schema and the generated SQL live apart since the frontend/backend/db
// split: schema is frontend app code (imported everywhere via @/db/schema),
// migrations are database artifacts owned by db/migrate.cjs.
export default defineConfig({
  schema: "./frontend/src/db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: "./db/data.db",
  },
  verbose: true,
  strict: true,
});
