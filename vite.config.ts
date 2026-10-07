import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

const cleanRemote = (): Plugin => ({
  name: 'clean-remote-url',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/remote' || req.url?.startsWith('/remote?')) req.url = req.url.replace('/remote', '/remote.html');
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/remote' || req.url?.startsWith('/remote?')) req.url = req.url.replace('/remote', '/remote.html');
      next();
    });
  },
});

export default defineConfig({
  plugins: [cleanRemote()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        remote: resolve(__dirname, 'remote.html'),
      },
    },
  },
});
