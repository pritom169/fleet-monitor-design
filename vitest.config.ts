import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['shared/vitest.config.ts', 'backend/vitest.config.ts', 'backend/vitest.int.config.ts', 'frontend/vite.config.ts'],
    coverage: {
      provider: 'v8',
      include: ['backend/src/**/*.ts', 'frontend/src/**/*.{ts,tsx}', 'shared/src/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        'backend/src/demo/**',
        'backend/src/load/**',
        'backend/src/ops/**',
        'backend/src/sim/**',
        'backend/src/test/**',
        'frontend/src/test/**',
        'backend/src/server/main.ts',
        'frontend/src/main.tsx',
        'frontend/src/data/types.ts',
      ],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 95 },
    },
  },
});
