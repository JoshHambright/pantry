import { describe, expect, it } from 'vitest'
import { loadEnv } from './env.js'

const base = { DATABASE_URL: 'postgres://pantry@127.0.0.1:5432/pantry' }

describe('loadEnv', () => {
  it('accepts a minimal configuration', () => {
    const env = loadEnv(base)
    expect(env.PORT).toBe(8080)
    expect(env.NODE_ENV).toBe('development')
  })

  it('refuses to start without a database', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/)
  })

  /**
   * Docker Compose substitutes unset variables as empty strings. Every one of
   * these arrives as `""` from a stock `docker compose up` with a .env that
   * leaves the optional lines blank — which is the documented way to run
   * without photo scanning.
   */
  describe('empty values from docker compose', () => {
    it('starts with a blank ANTHROPIC_API_KEY instead of crashing', () => {
      const env = loadEnv({ ...base, ANTHROPIC_API_KEY: '' })
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    })

    it('falls back to defaults rather than accepting an empty string', () => {
      const env = loadEnv({
        ...base,
        OFF_USER_AGENT: '',
        VISION_MODEL: '',
        SESSION_COOKIE_NAME: '',
      })
      expect(env.OFF_USER_AGENT).not.toBe('')
      expect(env.VISION_MODEL).toBe('claude-opus-5')
      expect(env.SESSION_COOKIE_NAME).toBe('pantry_session')
    })

    it('does not read a blank flag as an invalid enum', () => {
      const env = loadEnv({ ...base, COOKIE_SECURE: '', TRUST_PROXY: '' })
      expect(env.COOKIE_SECURE).toBe(false)
      expect(env.TRUST_PROXY).toBe(false)
    })

    it('does not coerce a blank port to zero', () => {
      expect(loadEnv({ ...base, PORT: '' }).PORT).toBe(8080)
    })

    it('treats whitespace as blank', () => {
      expect(loadEnv({ ...base, ANTHROPIC_API_KEY: '   ' }).ANTHROPIC_API_KEY).toBeUndefined()
    })

    it('exactly reproduces the environment docker compose builds', () => {
      // Copied from `docker compose config` with no ANTHROPIC_API_KEY set.
      const fromCompose = {
        ANTHROPIC_API_KEY: '',
        COOKIE_SECURE: 'false',
        DATABASE_URL: 'postgres://pantry:secret@db:5432/pantry',
        HOST: '0.0.0.0',
        OFF_USER_AGENT: 'Pantry/0.1 (self-hosted household inventory)',
        PORT: '8080',
        SESSION_TTL_DAYS: '30',
        TRUST_PROXY: 'false',
        VISION_MODEL: 'claude-opus-5',
        WEB_DIST: '/app/web',
        NODE_ENV: 'production',
      }
      const env = loadEnv(fromCompose)
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(env.PORT).toBe(8080)
      expect(env.WEB_DIST).toBe('/app/web')
    })
  })

  describe('database URL', () => {
    it('rejects a password that makes the URL invalid, and says how to fix it', () => {
      // `openssl rand -base64 24` produces a / about 40% of the time, and the
      // driver's own error for this is a bare "Invalid URL".
      expect(() => loadEnv({ DATABASE_URL: 'postgres://pantry:ab/cd@db:5432/pantry' })).toThrow(
        /percent-encode/,
      )
    })

    it('accepts a percent-encoded password', () => {
      const env = loadEnv({ DATABASE_URL: 'postgres://pantry:ab%2Fcd@db:5432/pantry' })
      expect(env.DATABASE_URL).toContain('%2F')
    })

    it('accepts the characters that are legal unencoded', () => {
      expect(() =>
        loadEnv({ DATABASE_URL: 'postgres://pantry:ab+cd=ef@db:5432/pantry' }),
      ).not.toThrow()
    })
  })

  it('still rejects a value that is present but wrong', () => {
    expect(() => loadEnv({ ...base, PORT: 'eight thousand' })).toThrow(/PORT/)
    expect(() => loadEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/)
  })

  it('reports every problem at once, not just the first', () => {
    // A self-hosted box should not need three restarts to learn three mistakes.
    try {
      loadEnv({ PORT: 'nope', NODE_ENV: 'staging' })
      expect.unreachable('should have thrown')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toMatch(/DATABASE_URL/)
      expect(message).toMatch(/PORT/)
      expect(message).toMatch(/NODE_ENV/)
    }
  })
})
