import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'backend-int',
    include: ['src/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    env: { LOG_LEVEL: 'warn' },
  },
});
