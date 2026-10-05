import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { createAccounts } from './server/accounts.js';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), ''), ...process.env };
  return {
  plugins: [{
    name: 'accounts-api',
    configureServer(server) {
      const accounts = createAccounts(env);
      server.middlewares.use(accounts.middleware);
      server.httpServer?.once('close', accounts.close);
      // Private server files must never be served by the development server.
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url || '').split('?')[0]);
        if (/^\/(data|server)(\/|$)/.test(path)) { res.statusCode=404; res.end(); }
        else next();
      });
    },
    configurePreviewServer(server) {
      const accounts = createAccounts(env);
      server.middlewares.use(accounts.middleware);
      server.httpServer?.once('close', accounts.close);
    },
  }, {
    name: 'copy-event-assets',
    apply: 'build',
    closeBundle() {
      cpSync(
        fileURLToPath(new URL('./assets/', import.meta.url)),
        fileURLToPath(new URL('./dist/assets/', import.meta.url)),
        { recursive: true },
      );
    },
  }],
  server: { fs: { deny: ['.env', '.env.*', '**/.git/**', '**/data/**', '**/server/**'] } },
  };
});
