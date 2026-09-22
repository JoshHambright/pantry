import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // Point tests at the shared package's source, not its build output.
      // Resolving through the package exports means a stale dist/ silently
      // tests the previous version — which it did, and the failures looked
      // like logic bugs rather than a missing build step.
      '@pantry/shared': `${here}packages/shared/src/index.ts`,
    },
  },
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/api/src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/api/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', 'apps/api/src/db/schema.ts'],
    },
  },
})
