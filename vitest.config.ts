import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  test: {
    root,
    include: ['packages/**/tests/**/*.test.ts', 'apps/**/tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
