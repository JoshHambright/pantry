import { and, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { requestSchema, respondToRequestSchema, type FamilyRequest } from '@pantry/shared'
import { requireAdult, requireMember } from '../context.js'
import { members, requests } from '../db/schema.js'
import { conflict, forbidden, notFound } from '../errors.js'
import { addIfAbsent } from '../services/shopping.js'

const toRequest = (
  row: typeof requests.$inferSelect,
  requestedByName: string,
): FamilyRequest => ({
  id: row.id,
  kind: row.kind,
  text: row.text,
  note: row.note,
  status: row.status,
  response: row.response,
  requestedById: row.requestedById,
  requestedByName,
  createdAt: row.createdAt.toISOString(),
  respondedAt: row.respondedAt?.toISOString() ?? null,
})

export async function registerRequestRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx

  app.get('/requests', async (request) => {
    const member = requireMember(request)
    const { status } = request.query as { status?: string }

    const rows = await db
      .select({ request: requests, memberName: members.name })
      .from(requests)
      .innerJoin(members, eq(members.id, requests.requestedById))
      .where(eq(requests.householdId, member.householdId))
      .orderBy(desc(requests.createdAt))

    const items = rows.map((row) => toRequest(row.request, row.memberName))
    return { requests: status ? items.filter((item) => item.status === status) : items }
  })

  /** The one write children get: asking for a meal or an item. */
  app.post('/requests', async (request, reply) => {
    const member = requireMember(request)
    const input = requestSchema.parse(request.body)

    const [created] = await db
      .insert(requests)
      .values({
        householdId: member.householdId,
        kind: input.kind,
        text: input.text,
        note: input.note ?? null,
        requestedById: member.id,
      })
      .returning()
    if (!created) throw conflict('Could not save that request')

    return reply.status(201).send(toRequest(created, member.name))
  })

  app.post('/requests/:id/respond', async (request) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }
    const input = respondToRequestSchema.parse(request.body)

    const [existing] = await db
      .select({ request: requests, memberName: members.name })
      .from(requests)
      .innerJoin(members, eq(members.id, requests.requestedById))
      .where(and(eq(requests.id, id), eq(requests.householdId, adult.householdId)))
      .limit(1)
    if (!existing) throw notFound('Request')

    const [updated] = await db
      .update(requests)
      .set({
        status: input.status,
        response: input.response ?? null,
        respondedById: adult.id,
        respondedAt: new Date(),
      })
      .where(eq(requests.id, id))
      .returning()
    if (!updated) throw notFound('Request')

    // Saying yes to a grocery request should put it on the list, not just
    // change a label nobody looks at again.
    if (input.status === 'approved' && updated.kind === 'grocery') {
      await addIfAbsent(db, {
        householdId: adult.householdId,
        text: updated.text,
        quantity: 1,
        unit: 'each',
        autoReason: 'request',
        requestedById: updated.requestedById,
        note: `Asked for by ${existing.memberName}`,
      })
    }

    return toRequest(updated, existing.memberName)
  })

  app.delete('/requests/:id', async (request, reply) => {
    const member = requireMember(request)
    const { id } = request.params as { id: string }

    const [existing] = await db
      .select()
      .from(requests)
      .where(and(eq(requests.id, id), eq(requests.householdId, member.householdId)))
      .limit(1)
    if (!existing) throw notFound('Request')
    // A child may take back their own ask; anything else is an adult's call.
    if (member.role !== 'adult' && existing.requestedById !== member.id) {
      throw forbidden('That is not yours to remove')
    }

    await db.delete(requests).where(eq(requests.id, id))
    return reply.status(204).send()
  })
}
