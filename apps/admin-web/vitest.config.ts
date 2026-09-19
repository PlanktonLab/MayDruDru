import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// 與 packages/ui 同一套設定：jsdom + @testing-library，globals 關著，
// describe / it / expect 一律從 'vitest' 明寫進來。
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', include: ['src/**/*.test.tsx'], globals: false },
})
