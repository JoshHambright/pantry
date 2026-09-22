import { createHash, randomBytes } from 'node:crypto'
import { eq, lt } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { members, sessions } from '../db/schema.js'

/** The cookie holds the raw token; only its digest is stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export interface AuthenticatedMember {
  id: string
  householdId: string
  name: string
  role: 'adult' | 'child'
  color: string
}

export async function createSession(
  db: Db,
  memberId: string,
  ttlDays: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken()
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000)
  await db.insert(sessions).values({ tokenHash: hashToken(token), memberId, expiresAt })
  return { token, expiresAt }
}

export async function resolveSession(
  db: Db,
  token: string | undefined,
): Promise<AuthenticatedMember | null> {
  if (!token) return null

  const rows = await db
    .select({
      id: members.id,
      householdId: members.householdId,
      name: members.name,
      role: members.role,
      color: members.color,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(members, eq(members.id, sessions.memberId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  if (row.expiresAt.getTime() <= Date.now()) return null

  return {
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    role: row.role,
    color: row.color,
  }
}

export async function destroySession(db: Db, token: string | undefined): Promise<void> {
  if (!token) return
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
}

export async function destroyAllSessionsFor(db: Db, memberId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.memberId, memberId))
}

/** Housekeeping so the table does not grow forever on a box nobody administers. */
export async function pruneExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))
}
