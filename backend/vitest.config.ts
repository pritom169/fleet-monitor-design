import { defineConfig } from 'vitest/config';

// Unit tests: fast, no Docker. Integration tests (*.int.test.ts) run with `npm run test:int`.
export default defineConfig({
  test: {
    name: 'backend',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts', 'node_modules/**'],
  },
});
