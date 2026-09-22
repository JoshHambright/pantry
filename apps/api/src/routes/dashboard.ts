import { and, desc, eq, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { DashboardSummary, FamilyRequest } from '@pantry/shared'
import { requireMember } from '../context.js'
import { mealPlanEntries, members, recipes, requests, shoppingItems } from '../db/schema.js'
import { loadStockRows, todayIso } from '../services/stock.js'

/**
 * The home screen. One request, because the thing it answers — "what needs
 * attention in this kitchen right now" — is one question.
 */
export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx

  app.get('/dashboard', async (request) => {
    const member = requireMember(request)
    const today = todayIso()

    const rows = await loadStockRows(db, member.householdId, { today })

    const expired = rows.filter((row) => row.worstExpiry === 'expired')
    const expiringSoon = rows.filter((row) => row.worstExpiry === 'soon')
    const lowStock = rows.filter((row) => (row.parShortfall ?? 0) > 0)

    const [shoppingCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(shoppingItems)
      .where(
        and(
          eq(shoppingItems.householdId, member.householdId),
          or(eq(shoppingItems.status, 'needed'), eq(shoppingItems.status, 'in_cart')),
        ),
      )

    const requestRows = await db
      .select({ request: requests, memberName: members.name })
      .from(requests)
      .innerJoin(members, eq(members.id, requests.requestedById))
      .where(
        and(eq(requests.householdId, member.householdId), eq(requests.status, 'open')),
      )
      .orderBy(desc(requests.createdAt))
      .limit(10)

    const openRequests: FamilyRequest[] = requestRows.map((row) => ({
      id: row.request.id,
      kind: row.request.kind,
      text: row.request.text,
      note: row.request.note,
      status: row.request.status,
      response: row.request.response,
      requestedById: row.request.requestedById,
      requestedByName: row.memberName,
      createdAt: row.request.createdAt.toISOString(),
      respondedAt: row.request.respondedAt?.toISOString() ?? null,
    }))

    const mealRows = await db
      .select({ entry: mealPlanEntries, recipeName: recipes.name })
      .from(mealPlanEntries)
      .leftJoin(recipes, eq(recipes.id, mealPlanEntries.recipeId))
      .where(
        and(eq(mealPlanEntries.householdId, member.householdId), eq(mealPlanEntries.date, today)),
      )

    const summary: DashboardSummary = {
      productCount: rows.length,
      lotCount: rows.reduce((sum, row) => sum + row.lots.length, 0),
      expiringSoon,
      expired,
      lowStock,
      openRequests,
      shoppingCount: shoppingCount?.count ?? 0,
      todaysMeals: mealRows.map((row) => ({
        id: row.entry.id,
        date: row.entry.date,
        slot: row.entry.slot,
        recipeId: row.entry.recipeId,
        recipeName: row.recipeName,
        customText: row.entry.customText,
        note: row.entry.note,
        servings: row.entry.servings,
        cookedAt: row.entry.cookedAt?.toISOString() ?? null,
        createdById: row.entry.createdById,
      })),
    }

    return summary
  })
}
