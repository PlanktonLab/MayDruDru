import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Point the dev proxy at another backend with API_URL (e.g. the compose one on 8200).
const API = process.env.API_URL || 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 5173 is admin-web; apply-web sits next to it.
    port: Number(process.env.PORT) || 5174,
    strictPort: false,
    proxy: {
      '^/api/': API,
      '^/v1/': API,
      '^/media/': API,
    },
  },
})
