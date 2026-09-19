import { defineConfig } from 'vitest/config'

// jsdom：`loadImage` / `probeQuality` 需要 canvas 與 ImageData 這類 DOM 型別。
// 測試一律離線：tesseract.js 由 vi.mock 取代，永遠不下載語言模型。
export default defineConfig({ test: { environment: 'jsdom', include: ['src/**/*.test.ts'] } })
