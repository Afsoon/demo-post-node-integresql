import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { loadEnv } from './config/env.ts'
import { createContainerFromEnv } from './container.ts'

const env = loadEnv()
const { container, pool } = createContainerFromEnv(env)
const app = createApp(container, { apiToken: env.API_TOKEN })

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Server is running on http://localhost:${info.port} (docs: /docs)`)
})

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`)
  server.close()
  await pool.end()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
