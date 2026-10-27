import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { createDevSupport, settingsFromEnv } from './server.mjs';

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const pluginRoot = path.resolve(webRoot, '..');
const manifest = JSON.parse(readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));

export default defineConfig(({ command, mode }) => {
  const common = {
    root: webRoot,
    base: './',
    esbuild: { jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment' },
  };
  // Build only the plugin entry. The standalone shell and its SDK stay out of the JAR.
  if (command === 'build') return {
    ...common,
    build: {
      outDir: 'build',
      emptyOutDir: true,
      sourcemap: mode === 'hub',
      minify: mode === 'hub' ? false : 'esbuild',
      rollupOptions: {
        input: path.join(webRoot, 'src/plugin.jsx'),
        preserveEntrySignatures: 'strict',
        output: {
          format: 'es',
          entryFileNames: 'assets/plugin.js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
  const env = loadEnv(mode, pluginRoot, 'JAVA_EXAMPLE_');
  const settings = settingsFromEnv(env, manifest.id, mode);
  const support = createDevSupport(settings, '/src/plugin.jsx', '/src');
  return {
    ...common,
    plugins: [{
      name: 'java-example-standalone',
      configureServer(server) {
        server.middlewares.use(support.middleware);
      },
      handleHotUpdate({ file, server }) {
        if (file.startsWith(path.join(webRoot, 'src') + path.sep)) {
          server.ws.send({ type: 'full-reload' });
          return [];
        }
      },
    }],
    server: {
      host: '127.0.0.1', port: settings.port, strictPort: true,
      fs: { allow: [webRoot] },
      proxy: support.proxy,
    },
  };
});
