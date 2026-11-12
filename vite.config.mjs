import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const { loadProjectDotenv, normalizePort } = require('./src/config/env.js');

loadProjectDotenv();

const devServerPort = normalizePort(process.env.DEV_SERVER_PORT, {
  defaultPort: 5173,
  portName: 'DEV_SERVER_PORT',
});

const reactDevtoolsPlugin = {
  name: 'react-devtools-client',
  apply: 'serve',
  transformIndexHtml(html) {
    const cspPattern = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]+)("\s*\/>)/;
    const entryScript = '<script type="module" src="/src/main.jsx"></script>';
    const devtoolsScript = '<script src="http://localhost:8097"></script>';

    if (!cspPattern.test(html) || !html.includes(entryScript)) {
      throw new Error('Unable to inject the React DevTools client into index.html');
    }

    return html
      .replace(cspPattern, (_, before, policy, after) => {
        const devPolicy = policy
          .replace("script-src 'self'", "script-src 'self' http://localhost:8097")
          .replace("connect-src 'self'", "connect-src 'self' ws://localhost:8097");
        return `${before}${devPolicy}${after}`;
      })
      .replace(entryScript, `${devtoolsScript}\n    ${entryScript}`);
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), reactDevtoolsPlugin],
  server: {
    host: '0.0.0.0',
    port: devServerPort,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
