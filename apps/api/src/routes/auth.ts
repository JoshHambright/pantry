import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { bootstrapSchema, loginSchema, type SessionInfo } from '@pantry/shared'
import { hashPin, verifyPin } from '../auth/pin.js'
import {
  createSession,
  destroySession,
  destroyAllSessionsFor,
  pruneExpiredSessions,
} from '../auth/session.js'
import { requireMember } from '../context.js'
import { households, locations, members } from '../db/schema.js'
import { conflict, notFound, unauthorized } from '../errors.js'

/** Locking out after this many wrong tries is what makes a 4-digit PIN viable. */
const MAX_FAILED_ATTEMPTS = 8
const LOCKOUT_MS = 5 * 60_000

/** A new household gets somewhere to put things, or the first scan has nowhere to go. */
const STARTER_LOCATIONS = [
  { name: 'Pantry', kind: 'pantry' as const, sortOrder: 0 },
  { name: 'Fridge', kind: 'fridge' as const, sortOrder: 1 },
  { name: 'Freezer', kind: 'freezer' as const, sortOrder: 2 },
]

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const { db, env } = app.ctx

  /** The sign-in picker: names and colours only, never anything secret. */
  app.get('/auth/members', async () => {
    const rows = await db
      .select({ id: members.id, name: members.name, role: members.role, color: members.color })
      .from(members)
      .orderBy(members.name)
    return { members: rows, bootstrapped: rows.length > 0 }
  })

  app.post('/auth/bootstrap', async (request, reply) => {
    const input = bootstrapSchema.parse(request.body)

    const existing = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(households)
      .limit(1)
    if ((existing[0]?.count ?? 0) > 0) throw conflict('This pantry has already been set up')

    const pinHash = await hashPin(input.pin)

    const member = await db.transaction(async (tx) => {
      const [household] = await tx
        .insert(households)
        .values({ name: input.householdName })
        .returning()
      if (!household) throw conflict('Could not create the household')

      await tx
        .insert(locations)
        .values(STARTER_LOCATIONS.map((location) => ({ ...location, householdId: household.id })))

      const [created] = await tx
        .insert(members)
        .values({
          householdId: household.id,
          name: input.memberName,
          role: 'adult',
          pinHash,
        })
        .returning()
      if (!created) throw conflict('Could not create the first member')
      return created
    })

    const { token, expiresAt } = await createSession(db, member.id, env.SESSION_TTL_DAYS)
    setSessionCookie(reply, env, token, expiresAt)
    return reply.status(201).send({ id: member.id, name: member.name, role: member.role })
  })

  app.post(
    '/auth/login',
    // Slow down a PIN guesser without locking the family out of their own pantry.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body)

      const [member] = await db
        .select()
        .from(members)
        .where(eq(members.id, input.memberId))
        .limit(1)
      if (!member) throw unauthorized('That PIN did not work')

      if (member.lockedUntil && member.lockedUntil.getTime() > Date.now()) {
        const minutes = Math.ceil((member.lockedUntil.getTime() - Date.now()) / 60_000)
        throw unauthorized(`Too many tries. Try again in ${minutes} minute(s).`)
      }

      const ok = await verifyPin(input.pin, member.pinHash)
      if (!ok) {
        const attempts = member.failedAttempts + 1
        await db
          .update(members)
          .set({
            failedAttempts: attempts,
            lockedUntil: attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null,
          })
          .where(eq(members.id, member.id))
        throw unauthorized('That PIN did not work')
      }

      await db
        .update(members)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(eq(members.id, member.id))

      await pruneExpiredSessions(db)
      const { token, expiresAt } = await createSession(db, member.id, env.SESSION_TTL_DAYS)
      setSessionCookie(reply, env, token, expiresAt)

      return { id: member.id, name: member.name, role: member.role, color: member.color }
    },
  )

  app.post('/auth/logout', async (request, reply) => {
    await destroySession(db, request.cookies[env.SESSION_COOKIE_NAME])
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' })
    return { ok: true }
  })

  app.post('/auth/logout-everywhere', async (request, reply) => {
    const member = requireMember(request)
    await destroyAllSessionsFor(db, member.id)
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' })
    return { ok: true }
  })

  app.get('/auth/session', async (request): Promise<SessionInfo> => {
    const member = requireMember(request)

    const [row] = await db
      .select({
        createdAt: members.createdAt,
        householdId: households.id,
        householdName: households.name,
      })
      .from(members)
      .innerJoin(households, eq(households.id, members.householdId))
      .where(eq(members.id, member.id))
      .limit(1)
    if (!row) throw notFound('Household')

    return {
      member: {
        id: member.id,
        name: member.name,
        role: member.role,
        color: member.color,
        createdAt: row.createdAt.toISOString(),
      },
      household: { id: row.householdId, name: row.householdName },
    }
  })
}

function setSessionCookie(
  reply: { setCookie: (name: string, value: string, options: Record<string, unknown>) => unknown },
  env: { SESSION_COOKIE_NAME: string; COOKIE_SECURE: boolean },
  token: string,
  expiresAt: Date,
): void {
  reply.setCookie(env.SESSION_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    expires: expiresAt,
  })
}
