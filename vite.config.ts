import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import type { Connect, Plugin } from 'vite';

// Spectator mode (PROGRESS M8.9): serve runs/<name>.json, which tools/play.ts rewrites after every command,
// to the UI opened with ?spectate=<name>. Dev and preview servers only; nothing is built into dist/.
const spectateRoute: Connect.NextHandleFunction = (req, res, next) => {
  const m = /\/__spectate\/([\w.-]+?)(?:\.json)?(?:\?.*)?$/.exec(req.url ?? '');
  if (!m) return next();
  readFile(`runs/${m[1]}.json`, 'utf8').then(
    (text) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(text);
    },
    () => {
      res.statusCode = 404;
      res.end(`runs/${m[1]}.json not found`);
    },
  );
};
const spectate = (): Plugin => ({
  name: 'goal-mode-spectate',
  configureServer: (server) => void server.middlewares.use(spectateRoute),
  configurePreviewServer: (server) => void server.middlewares.use(spectateRoute),
});

export default defineConfig({
  // Relative asset paths so dist/ works from any static host sub-path.
  base: './',
  plugins: [react(), spectate()],
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 30_000,
  },
});
