import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/": tests import app modules the same way the app does.
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // better-sqlite3 keeps one connection per process; serial files keep DB-backed tests from racing.
    fileParallelism: false,
  },
});
