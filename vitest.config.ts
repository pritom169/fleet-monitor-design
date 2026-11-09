import { defineConfig } from 'vitest/config';

/**
 * Combined coverage: shared + backend unit + backend integration (needs Docker) + frontend, in one report.
 *   npm run test:coverage
 * `npm test` stays fast and Docker-free; it runs each package's own config.
 */
export default defineConfig({
  test: {
    projects: ['shared/vitest.config.ts', 'backend/vitest.config.ts', 'backend/vitest.int.config.ts', 'frontend/vite.config.ts'],
    coverage: {
      provider: 'v8',
      include: ['backend/src/**/*.ts', 'frontend/src/**/*.{ts,tsx}', 'shared/src/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        // Dev and ops tooling: never runs in production.
        'backend/src/demo/**', // in-memory demo backend (npm run dev)
        'backend/src/load/**', // load test
        'backend/src/ops/**', // PKI generator
        'backend/src/sim/**', // robot simulators and the seed script
        'backend/src/test/**', // integration-test harness
        'frontend/src/test/**', // test setup and fixtures
        // Entry points: only wire the tested modules to the process (env, signals, DOM root).
        'backend/src/server/main.ts',
        'frontend/src/main.tsx',
        // Type declarations only.
        'frontend/src/data/types.ts',
      ],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 95 },
    },
  },
});
