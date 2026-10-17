import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: {
    host: '127.0.0.1', port: 1420, strictPort: true,
    allowedHosts: ['127.0.0.1', 'localhost'],
    watch: { ignored: ['**/src-tauri/**', '**/artifacts/**'] },
    fs: { strict: true, deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/src-tauri/**'] },
  },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, rollupOptions: { input: { island: 'index.html', preferences: 'preferences.html' } } },
});
