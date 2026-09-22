import { buildApp } from './app.js'
import { createDb } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { loadEnv } from './env.js'
import { createOpenFoodFactsLookup } from './services/openfoodfacts.js'
import { createClaudeVisionProvider, unavailableVisionProvider } from './services/vision.js'

async function main(): Promise<void> {
  const env = loadEnv()

  // Migrating on boot keeps a self-hosted box working after a plain
  // `docker compose pull && up` with nobody remembering a manual step.
  await runMigrations(env.DATABASE_URL)

  const { db, close } = createDb(env.DATABASE_URL)

  const vision = env.ANTHROPIC_API_KEY
    ? createClaudeVisionProvider({
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.VISION_MODEL,
        maxImageBytes: env.VISION_MAX_IMAGE_BYTES,
      })
    : unavailableVisionProvider

  const app = await buildApp({
    env,
    db,
    vision,
    productLookup: createOpenFoodFactsLookup({
      baseUrl: env.OFF_BASE_URL,
      userAgent: env.OFF_USER_AGENT,
      timeoutMs: env.OFF_TIMEOUT_MS,
    }),
  })

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down')
    await app.close()
    await close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  await app.listen({ host: env.HOST, port: env.PORT })
  app.log.info(
    { vision: vision.available },
    vision.available ? 'photo scanning enabled' : 'photo scanning off (no ANTHROPIC_API_KEY)',
  )
}

main().catch((error: unknown) => {
  console.error('failed to start', error)
  process.exit(1)
})
