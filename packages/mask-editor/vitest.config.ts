import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// jsdom + 假的 tesseract worker：測試不下載語言模型、不碰網路。
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
