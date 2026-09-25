import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'apps/api/drizzle/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Dev scripts are plain Node ESM, outside the TypeScript projects, so the
    // Node globals have to be declared for them explicitly. The browser globals
    // are here too: the bodies passed to page.evaluate() are serialised and run
    // inside Chromium, so they are legitimately not Node code.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        caches: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        window: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
)
