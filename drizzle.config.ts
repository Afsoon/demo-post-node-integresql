import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infra/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://metered:metered@%2Ftmp%2Fpgtest:6432/metered',
  },
})
