import { realpathSync } from 'node:fs'
import { argv } from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * True only when this module is the file node was told to run.
 *
 * The tempting one-liner — `import.meta.url.endsWith('thing.js')` — is true
 * whenever the module is *imported* as well, so a script guarded that way runs
 * itself as a side effect of any import. That turned `node dist/index.js` into
 * a process that migrated and then called process.exit(0) before the server
 * ever listened.
 */
export function isEntrypoint(moduleUrl: string): boolean {
  const entry = argv[1]
  if (entry === undefined) return false
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entry)
  } catch {
    return false
  }
}
