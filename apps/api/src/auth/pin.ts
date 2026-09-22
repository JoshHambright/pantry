import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

/**
 * A four-digit PIN has about 13 bits of entropy, so the hash cost is doing real
 * work here — paired with the lockout in the login route, it is what makes a
 * PIN acceptable on a household LAN. Do not lower these without reading
 * DECISIONS.md D-004.
 */
const KEY_LENGTH = 64
const COST = 2 ** 15
const BLOCK_SIZE = 8
const PARALLELISM = 1
/** 128 * N * r is ~33MB here, over Node's 32MB default, so it must be raised explicitly. */
const MAX_MEM = 96 * 1024 * 1024

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = (await scrypt(pin, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: MAX_MEM,
  })) as Buffer
  return [
    'scrypt',
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$')
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, costRaw, blockRaw, parallelRaw, saltRaw, hashRaw] = parts
  const cost = Number.parseInt(costRaw ?? '', 10)
  const blockSize = Number.parseInt(blockRaw ?? '', 10)
  const parallelism = Number.parseInt(parallelRaw ?? '', 10)
  if (!cost || !blockSize || !parallelism || !saltRaw || !hashRaw) return false

  const expected = Buffer.from(hashRaw, 'base64')
  let derived: Buffer
  try {
    derived = (await scrypt(pin, Buffer.from(saltRaw, 'base64'), expected.length, {
      N: cost,
      r: blockSize,
      p: parallelism,
      maxmem: MAX_MEM,
    })) as Buffer
  } catch {
    return false
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected)
}
