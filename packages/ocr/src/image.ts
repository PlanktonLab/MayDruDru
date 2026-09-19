/** 瀏覽器端讀檔、縮圖與品質探測（SPEC §8.1 上傳流程第 1 步、§11 隱私）。
 *
 * ⚠️ 這個檔案的所有函式都必須在瀏覽器執行；原圖永遠不離開這個分頁的記憶體。
 * 自 submit-flow `lib/image.ts` 搬遷，差別是**品質檢查改為啟用**
 * （SPEC §8.1 要求模糊／過暗要警告），並把純計算的部分拆成可單測的函式。
 */

import type { LoadedImage, QualityProbe } from './types'

/** SPEC §8.1：長邊縮到 2400。 */
export const MAX_LONG_EDGE = 2400
/** 85%：檔案夠小，但文字仍可辨識。 */
export const JPEG_QUALITY = 0.85

/** 品質門檻（初始值，需以實際案件校準）。 */
export const QUALITY_THRESHOLDS = {
  minLongEdge: 1000,
  minSharpness: 0.35,
  minBrightness: 0.2,
  maxBrightness: 0.9,
} as const

/** 由副檔名與 MIME 推得原始格式。 */
export function detectFormat(file: File): string {
  // submit-flow 版的 `split('.').pop()` 對沒有小數點的檔名會把整個檔名當副檔名，
  // 這裡修掉：沒有副檔名就只看 MIME。
  const dot = file.name.lastIndexOf('.')
  const ext = dot > 0 ? file.name.slice(dot + 1).toUpperCase() : ''
  if (ext === 'HEIC' || ext === 'HEIF') return ext
  if (file.type === 'image/heic' || file.type === 'image/heif') return 'HEIC'
  if (file.type === 'application/pdf' || ext === 'PDF') return 'PDF'
  if (file.type === 'image/png' || ext === 'PNG') return 'PNG'
  if (file.type === 'image/jpeg' || ext === 'JPG' || ext === 'JPEG') return 'JPEG'
  return ext || 'UNKNOWN'
}

/** 這個檔案是不是 HEIC／HEIF（`loadImage` 失敗時要換一句話講）。 */
export function isHeic(file: File): boolean {
  return detectFormat(file) === 'HEIC' || detectFormat(file) === 'HEIF'
}

/** HEIC 讀不到時的訊息：說「怎麼修」，不說「錯在哪」（SPEC §15.5）。 */
export const HEIC_UNSUPPORTED_MESSAGE =
  '這支瀏覽器打不開 HEIC 照片。請改用「拍照」直接上傳，或到手機「設定 → 相機 → 格式」選「最相容」後重拍一張。'

export const UNREADABLE_FILE_MESSAGE =
  '這個檔案讀不出來。請改上傳 JPG、PNG 或 PDF，或用手機直接拍一張新的照片。'

/** 縮圖後的尺寸：長邊不超過 `maxLongEdge`，且永不放大。 */
export function resizeDimensions(
  width: number,
  height: number,
  maxLongEdge: number = MAX_LONG_EDGE,
): { width: number; height: number; scale: number } {
  const scale = Math.min(1, maxLongEdge / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale }
}

/**
 * 讀入檔案 → 縮至長邊 2400 → 品質探測。
 *
 * HEIC 交給瀏覽器的 `createImageBitmap`（Safari／iOS 可直接解）；解不開時丟出
 * 一句市民看得懂、而且**告訴他怎麼做**的錯誤訊息，不靜默失敗。
 * PDF 不走這裡，請用 `pdfToPageCanvases()`。
 */
export async function loadImage(file: File): Promise<LoadedImage> {
  const originalFormat = detectFormat(file)

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(isHeic(file) ? HEIC_UNSUPPORTED_MESSAGE : UNREADABLE_FILE_MESSAGE)
  }

  const originalLongEdge = Math.max(bitmap.width, bitmap.height)
  const { width, height } = resizeDimensions(bitmap.width, bitmap.height)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error(UNREADABLE_FILE_MESSAGE)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  const probe = probeQuality(ctx.getImageData(...centredSample(width, height)), originalLongEdge)
  return { canvas, width, height, originalFormat, probe, qualityNote: qualityIssue(probe) }
}

/** 取中央最多 640×640 的取樣區：文件的字通常在中間，邊緣多半是背景。 */
export function centredSample(width: number, height: number): [number, number, number, number] {
  const sw = Math.min(width, 640)
  const sh = Math.min(height, 640)
  return [Math.floor((width - sw) / 2), Math.floor((height - sh) / 2), sw, sh]
}

/**
 * 從一塊 ImageData 估計清晰度與亮度。
 *
 * 清晰度用 Laplacian 變異數：模糊影像的高頻成分少、變異數低。為了在手機上
 * 夠快（< 2 秒），只掃 stride 2 的格點而非逐像素。係數 12 是經驗值。
 */
export function probeQuality(image: ImageData, originalLongEdge: number): QualityProbe {
  const { width: sw, height: sh, data } = image
  const gray = new Float32Array(sw * sh)
  let sum = 0
  for (let i = 0; i < sw * sh; i++) {
    const p = i * 4
    const g = (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114) / 255
    gray[i] = g
    sum += g
  }
  const brightness = sw * sh > 0 ? sum / (sw * sh) : 0

  let lapSum = 0
  let lapSqSum = 0
  let n = 0
  for (let y = 1; y < sh - 1; y += 2) {
    for (let x = 1; x < sw - 1; x += 2) {
      const i = y * sw + x
      const lap = Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - sw] - gray[i + sw])
      lapSum += lap
      lapSqSum += lap * lap
      n++
    }
  }
  const mean = n > 0 ? lapSum / n : 0
  const variance = n > 0 ? Math.max(0, lapSqSum / n - mean * mean) : 0

  return { longEdge: originalLongEdge, sharpness: Math.min(1, Math.sqrt(variance) * 12), brightness }
}

/**
 * 把量測值翻成一句話。順序刻意固定：模糊 → 太暗 → 太亮，
 * 一次只講一件事，講的是「怎麼修」。通過則回 null。
 *
 * 解析度不再提醒：手機截圖與網銀下載的帳單本來就常是小圖，但字是清楚的——
 * 用長邊判斷會對這些完全正常的檔案發出假警報。真的看不清楚時，模糊那一條
 * 會抓到。
 */
export function qualityIssue(probe: QualityProbe): string | null {
  const t = QUALITY_THRESHOLDS
  if (probe.sharpness < t.minSharpness)
    return '照片有點模糊。請把手機放穩、等畫面對到焦再按快門，文件四個角都要在畫面內。'
  if (probe.brightness < t.minBrightness)
    return '照片偏暗。請到光線充足的地方重拍，並避免背光。'
  if (probe.brightness > t.maxBrightness)
    return '照片過亮、有反光。請避開直射的燈光或陽光，換個角度再拍一次。'
  return null
}

/** 輸出為可上傳的 JPEG data URL。只有這個函式的輸出會離開瀏覽器。 */
export function toJpegDataUrl(canvas: HTMLCanvasElement, quality: number = JPEG_QUALITY): string {
  return canvas.toDataURL('image/jpeg', quality)
}

/** 輸出為 Blob（送出時用 multipart 比 data URL 省一次 base64 膨脹）。 */
export function toBlob(
  canvas: HTMLCanvasElement,
  type = 'image/jpeg',
  quality: number = JPEG_QUALITY,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(UNREADABLE_FILE_MESSAGE))),
      type,
      quality,
    )
  })
}

/** 送出後清掉暫存影像（SPEC §11：市民截圖只在記憶體）。 */
export function disposeCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}
