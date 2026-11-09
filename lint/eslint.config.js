/**
 * ESLint for Fleet Monitor. Loaded through the root `eslint.config.js`, so globs are relative to the repo root.
 *
 * This lives in its own workspace because typescript-eslint parses with the TypeScript 6 compiler API, and the
 * packages type-check with TypeScript 7 (`tsc`), which has no such API. Lint is syntax and React rules only;
 * types are `npm run typecheck`'s job, so no rule here needs type information.
 */
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_name` marks a parameter that is deliberately unused (a callback signature).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Narrow, don't assert. The `Robot` union exists so `report!` is never needed.
      '@typescript-eslint/no-non-null-assertion': 'error',
      // `x != null` is the one idiomatic loose check (null or undefined).
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // The client: hooks rules, including the React Compiler checks (purity, refs, set-state-in-render).
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.flat['recommended-latest'].rules,
      'react-hooks/exhaustive-deps': 'error',
    },
    languageOptions: { globals: globals.browser },
  },

  // Tests may assert what they have just set up.
  {
    files: ['**/*.test.{ts,tsx}', 'frontend/src/test/**', 'e2e/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },

  { files: ['shared/src/**/*.ts', 'e2e/**/*.ts', '*.config.ts'], languageOptions: { globals: globals.node } },
);
