import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

export type Db = PostgresJsDatabase<typeof schema>

export interface DbHandle {
  db: Db
  close: () => Promise<void>
}

export function createDb(url: string, options: { max?: number } = {}): DbHandle {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => {} })
  const db = drizzle(client, { schema, casing: 'snake_case' })
  return { db, close: () => client.end({ timeout: 5 }) }
}

export { schema }
