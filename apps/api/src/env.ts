import { z } from 'zod'

/**
 * Configuration is read once at boot and validated hard: a self-hosted box that
 * starts with a broken config and fails at 6pm on a Tuesday is worse than one
 * that refuses to start at all.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    // The driver throws a bare "Invalid URL" on a password containing a
    // character that is illegal in a URL's userinfo — `/` is the common one,
    // since it appears in about 40% of `openssl rand -base64` output. Catch it
    // here, where we can say what to do about it.
    .refine((value) => {
      try {
        new URL(value)
        return true
      } catch {
        return false
      }
    }, 'is not a valid URL. If the password contains / @ : # or ?, percent-encode it ' + '(a / becomes %2F) or generate one with `openssl rand -hex 32`'),

  SESSION_COOKIE_NAME: z.string().default('pantry_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Off by default so plain-HTTP access on the LAN works; DEPLOY.md explains when to turn it on. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  /** Absent is fine — camera scanning degrades to barcode-only, nothing else breaks. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  VISION_MODEL: z.string().default('claude-opus-5'),
  VISION_MAX_IMAGE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),

  /** Open Food Facts asks every client to identify itself. */
  OFF_USER_AGENT: z.string().default('Pantry/0.1 (self-hosted household inventory)'),
  OFF_BASE_URL: z.string().default('https://world.openfoodfacts.org'),
  OFF_TIMEOUT_MS: z.coerce.number().int().positive().default(6000),

  /** When set, the API also serves the built web app from this directory. */
  WEB_DIST: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

/**
 * Docker Compose substitutes an unset variable as an empty string, not as an
 * absent key: `ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}` arrives as `""`. An
 * empty string is not "no value" to zod — it is a value that fails `.min(1)`,
 * which turned "deploy without photo scanning" into a boot failure. Treating
 * empty as absent also lets every `.default()` apply, which is what an operator
 * who blanked a line in .env means.
 */
function withoutEmptyValues(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== '') cleaned[key] = value
  }
  return cleaned
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(withoutEmptyValues(source))
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  return parsed.data
}
