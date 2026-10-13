// Server dev: menjalankan API + media server pada port 5174.
// UI (vite, port 5173) mem-proxy /api dan /media ke sini.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { startServer } = require('./services/server.cjs');
const { MEDIA_PORT } = require('./services/core.cjs');

startServer().then(() => {
  console.log(`[dcut] dev API + media server berjalan di http://localhost:${MEDIA_PORT}`);
});
