import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so dist/ works from any static host sub-path.
  base: './',
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 30_000,
  },
});
