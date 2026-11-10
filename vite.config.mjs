import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const reactDevtoolsPlugin = {
  name: 'react-devtools-client',
  apply: 'serve',
  transformIndexHtml(html) {
    const cspPattern = /(<meta http-equiv="Content-Security-Policy" content=")([^"]+)(" \/>)/;
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
  }
};

export default defineConfig({
  plugins: [react(), reactDevtoolsPlugin],
  server: {
    host: '0.0.0.0',
    port: 5173
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
