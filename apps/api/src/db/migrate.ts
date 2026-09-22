import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createDb } from './client.js'
import { loadEnv } from '../env.js'
import { isEntrypoint } from '../entrypoint.js'

/** Applies everything in apps/api/drizzle. Safe to run on every container start. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url))
  // dist/db -> apps/api/drizzle
  const migrationsFolder = resolve(here, '../../drizzle')
  const handle = createDb(databaseUrl, { max: 1 })
  try {
    await migrate(handle.db, { migrationsFolder })
  } finally {
    await handle.close()
  }
}

if (isEntrypoint(import.meta.url)) {
  const env = loadEnv()
  runMigrations(env.DATABASE_URL)
    .then(() => {
      console.info('migrations applied')
      process.exit(0)
    })
    .catch((error: unknown) => {
      console.error('migration failed', error)
      process.exit(1)
    })
}
