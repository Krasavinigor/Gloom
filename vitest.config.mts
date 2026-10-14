import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/components/**/*.test.tsx', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/features/**/*.{ts,tsx}', 'src/server/config/**/*.ts', 'src/server/db/**/*.ts', 'src/server/storage/**/*.ts', 'src/server/http/**/*.ts', 'src/server/wardrobe/**/*.ts'],
      exclude: ['**/*.test.*', 'src/server/http/runtime-handlers.ts', 'src/server/wardrobe/runtime.ts'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
