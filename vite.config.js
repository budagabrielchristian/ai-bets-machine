import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development the API server runs separately (npm run server) and Vite
// forwards API and login requests to it. In production the server serves the
// built files itself.
const backend = 'http://127.0.0.1:' + (process.env.PORT || 8787)

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backend,
      '/login': backend,
      '/login.css': backend,
    }
  },
  build: { sourcemap: false }
})
