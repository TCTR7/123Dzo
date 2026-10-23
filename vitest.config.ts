import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['unit_test/**/*.test.ts', 'unit_test/**/*.spec.ts'],
    setupFiles: ['./unit_test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './unit_test/coverage',
      include: ['src/**/*.{ts,tsx}'],
      thresholds: { lines: 80 },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
