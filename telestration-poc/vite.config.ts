import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Dedicated port + strictPort so it never silently drifts (5174/5175…) into another
  // project's dev server — electron:dev / wait-on / main.cjs all expect exactly this port.
  server: { port: 5178, strictPort: true, open: false },
});
