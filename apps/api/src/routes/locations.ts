import { and, asc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { locationSchema, type Location } from '@pantry/shared'
import { requireAdult, requireMember } from '../context.js'
import { locations, lots } from '../db/schema.js'
import { conflict, notFound } from '../errors.js'

const toLocation = (row: typeof locations.$inferSelect): Location => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  sortOrder: row.sortOrder,
})

export async function registerLocationRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx

  app.get('/locations', async (request) => {
    const member = requireMember(request)
    const rows = await db
      .select()
      .from(locations)
      .where(eq(locations.householdId, member.householdId))
      .orderBy(asc(locations.sortOrder), asc(locations.name))
    return { locations: rows.map(toLocation) }
  })

  app.post('/locations', async (request, reply) => {
    const adult = requireAdult(request)
    const input = locationSchema.parse(request.body)

    const [created] = await db
      .insert(locations)
      .values({
        householdId: adult.householdId,
        name: input.name,
        kind: input.kind,
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      })
      .returning()
      .onConflictDoNothing()
    if (!created) throw conflict('There is already a place with that name')

    return reply.status(201).send(toLocation(created))
  })

  app.patch('/locations/:id', async (request) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }
    const input = locationSchema.partial().parse(request.body)

    const [updated] = await db
      .update(locations)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      })
      .where(and(eq(locations.id, id), eq(locations.householdId, adult.householdId)))
      .returning()
    if (!updated) throw notFound('Location')

    return toLocation(updated)
  })

  app.delete('/locations/:id', async (request, reply) => {
    const adult = requireAdult(request)
    const { id } = request.params as { id: string }

    const stored = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(lots)
      .where(eq(lots.locationId, id))
    const count = stored[0]?.count ?? 0
    // The foreign key would refuse anyway; this says why in plain words.
    if (count > 0) throw conflict(`Move the ${count} thing(s) stored there first`)

    const deleted = await db
      .delete(locations)
      .where(and(eq(locations.id, id), eq(locations.householdId, adult.householdId)))
      .returning({ id: locations.id })
    if (deleted.length === 0) throw notFound('Location')

    return reply.status(204).send()
  })
}
