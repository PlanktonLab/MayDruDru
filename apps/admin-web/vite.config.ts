import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Point the dev proxy at another backend with API_URL (e.g. a local uvicorn next to the docker one).
const API = process.env.API_URL || 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
    proxy: {
      '^/api/': API,
      '^/v1/': API,
      '^/media/': API,
    },
  },
})
