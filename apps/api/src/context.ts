import type { Db } from './db/client.js'
import type { Env } from './env.js'
import type { ProductLookup } from './services/openfoodfacts.js'
import type { VisionProvider } from './services/vision.js'
import type { AuthenticatedMember } from './auth/session.js'
import { forbidden, unauthorized } from './errors.js'

export interface AppContext {
  env: Env
  db: Db
  vision: VisionProvider
  productLookup: ProductLookup
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext
  }
  interface FastifyRequest {
    member: AuthenticatedMember | null
  }
}

export function requireMember(request: { member: AuthenticatedMember | null }) {
  if (!request.member) throw unauthorized()
  return request.member
}

/**
 * Children can ask for things; only adults can change what the house actually
 * has. Every write route that is not a request or a profile read goes through
 * this.
 */
export function requireAdult(request: { member: AuthenticatedMember | null }) {
  const member = requireMember(request)
  if (member.role !== 'adult') {
    throw forbidden('Ask a grown-up to do that one')
  }
  return member
}
