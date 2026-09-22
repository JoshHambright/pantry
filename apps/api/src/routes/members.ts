import { and, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { createMemberSchema, updateMemberSchema, type Member } from '@pantry/shared'
import { hashPin } from '../auth/pin.js'
import { destroyAllSessionsFor } from '../auth/session.js'
import { requireAdult, requireMember } from '../context.js'
import { members } from '../db/schema.js'
import { conflict, notFound } from '../errors.js'

const toMember = (row: typeof members.$inferSelect): Member => ({
  id: row.id,
  name: row.name,
  role: row.role,
  color: row.color,
  createdAt: row.createdAt.toISOString(),
})

export async function registerMemberRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx

  app.get('/members', async (request) => {
    const member = requireMember(request)
    const rows = await db
      .select()
      .from(members)
      .where(eq(members.householdId, member.householdId))
      .orderBy(members.name)
    return { members: rows.map(toMember) }
  })

  app.post('/members', async (request, reply) => {
    const adult = requireAdult(request)
    const input = createMemberSchema.parse(request.body)

    const [created] = await db
      .insert(members)
      .values({
        householdId: adult.householdId,
        name: input.name,
        role: input.role,
        pinHash: await hashPin(input.pin),
        ...(input.color ? { color: input.color } : {}),
      })
      .returning()
    if (!created) throw conflict('Could not add that person')

    return reply.status(201).send(toMember(created))
  })

  app.patch('/members/:id', async (request) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }
    const input = updateMemberSchema.parse(request.body)

    const [existing] = await db
      .select()
      .from(members)
      .where(and(eq(members.id, id), eq(members.householdId, adult.householdId)))
      .limit(1)
    if (!existing) throw notFound('Member')

    const [updated] = await db
      .update(members)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.color === undefined ? {} : { color: input.color }),
        ...(input.pin === undefined ? {} : { pinHash: await hashPin(input.pin), failedAttempts: 0, lockedUntil: null }),
      })
      .where(eq(members.id, id))
      .returning()
    if (!updated) throw notFound('Member')

    // A changed PIN should not leave old sessions signed in.
    if (input.pin !== undefined) await destroyAllSessionsFor(db, id)

    return toMember(updated)
  })

  app.delete('/members/:id', async (request, reply) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }

    if (id === adult.id) throw conflict('You cannot remove yourself')

    const tally = await db
      .select({ adults: sql<number>`count(*) filter (where ${members.role} = 'adult')::int` })
      .from(members)
      .where(eq(members.householdId, adult.householdId))
    const adults = tally[0]?.adults ?? 0
    const [target] = await db
      .select()
      .from(members)
      .where(and(eq(members.id, id), eq(members.householdId, adult.householdId)))
      .limit(1)
    if (!target) throw notFound('Member')
    // Removing the last adult would lock the household out of its own pantry.
    if (target.role === 'adult' && adults <= 1) throw conflict('The household needs one grown-up')

    await db.delete(members).where(eq(members.id, id))
    return reply.status(204).send()
  })
}
