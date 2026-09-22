import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { resolveSession } from './auth/session.js'
import type { AppContext } from './context.js'
import { HttpError } from './errors.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerDashboardRoutes } from './routes/dashboard.js'
import { registerInventoryRoutes } from './routes/inventory.js'
import { registerLocationRoutes } from './routes/locations.js'
import { registerMealPlanRoutes } from './routes/mealplan.js'
import { registerMemberRoutes } from './routes/members.js'
import { registerProductRoutes } from './routes/products.js'
import { registerRecipeRoutes } from './routes/recipes.js'
import { registerRequestRoutes } from './routes/requests.js'
import { registerScanRoutes } from './routes/scan.js'
import { registerShoppingRoutes } from './routes/shopping.js'

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: ctx.env.NODE_ENV === 'test' ? 'silent' : 'info',
      // Nobody needs a PIN or a session cookie in the logs of a box in a closet.
      redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.pin'],
    },
    trustProxy: ctx.env.TRUST_PROXY,
    bodyLimit: ctx.env.VISION_MAX_IMAGE_BYTES * 4 + 1_048_576,
  })

  app.decorate('ctx', ctx)
  app.decorateRequest('member', null)

  await app.register(cookie)
  // Rate limits are per-process and keyed by IP, which makes an integration
  // suite hitting /auth/login dozens of times look exactly like an attacker.
  // The PIN lockout in the login route is the protection that matters and it
  // stays on in every environment, including tests.
  if (ctx.env.NODE_ENV !== 'test') {
    await app.register(rateLimit, {
      global: false,
      max: 60,
      timeWindow: '1 minute',
    })
  }
  await app.register(multipart, {
    limits: { fileSize: ctx.env.VISION_MAX_IMAGE_BYTES, files: 5 },
  })

  app.addHook('preHandler', async (request) => {
    const token = request.cookies[ctx.env.SESSION_COOKIE_NAME]
    request.member = await resolveSession(ctx.db, token)
  })

  app.setErrorHandler((error: unknown, request, reply) => {
    // Fastify hands this back untyped; narrow before trusting any field.
    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? (error as { statusCode?: unknown }).statusCode
        : undefined

    if (error instanceof HttpError) {
      return reply
        .status(error.statusCode)
        .send({ error: error.code, message: error.message, details: error.details })
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'bad_request',
        message: 'That does not look right',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      })
    }
    if (statusCode === 429) {
      return reply
        .status(429)
        .send({ error: 'too_many_requests', message: 'Slow down for a moment' })
    }
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      const message = error instanceof Error ? error.message : 'That request was not valid'
      return reply.status(statusCode).send({ error: 'bad_request', message })
    }

    request.log.error({ err: error }, 'unhandled error')
    return reply
      .status(500)
      .send({ error: 'internal_error', message: 'Something went wrong on the server' })
  })

  app.get('/api/health', async () => ({ ok: true, vision: ctx.vision.available }))

  await app.register(
    async (api) => {
      await registerAuthRoutes(api)
      await registerMemberRoutes(api)
      await registerLocationRoutes(api)
      await registerProductRoutes(api)
      await registerInventoryRoutes(api)
      await registerShoppingRoutes(api)
      await registerRequestRoutes(api)
      await registerRecipeRoutes(api)
      await registerMealPlanRoutes(api)
      await registerScanRoutes(api)
      await registerDashboardRoutes(api)
    },
    { prefix: '/api' },
  )

  if (ctx.env.WEB_DIST) {
    await app.register(fastifyStatic, { root: ctx.env.WEB_DIST })
    // Client-side routing: anything that is not an API call renders the app.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'not_found', message: 'No such endpoint' })
      }
      return reply.sendFile('index.html')
    })
  }

  return app
}
