/** 卡號的純函式：OCR 數字正規化與 Luhn 檢查。
 *
 * 這個檔案**不 import tesseract.js**，只吃結構相符的物件，所以測試餵假資料即可。
 * 自 submit-flow `lib/creditCardOcr.ts` 搬遷。
 */

export interface Bbox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface WordLike {
  text: string
  confidence: number
  bbox: Bbox
}

export interface LineLike {
  words: WordLike[]
}

/** 一個數字字元，以及它在原圖上的位置。 */
export interface DigitSymbol {
  text: string
  confidence: number
  bbox: Bbox
}

/**
 * OCR 常把壓印的字讀錯：`O` 其實是 `0`，`I`／`l`／`|` 其實是 `1`。
 * 這個修正**只對已經含有數字的詞**套用，否則人名會被當成卡號。
 */
export function normalizeOcrDigit(character: string): string {
  if (character === 'O') return '0'
  if (/[Il|]/.test(character)) return '1'
  return character
}

/**
 * 把一個 OCR 詞拆成數字，並平均切分詞的 bbox 當作每個字元的位置。
 *
 * 完全不含數字的詞直接跳過——這是「名字不會變成卡號」的那道保險。
 */
export function digitsOfWord(word: WordLike): DigitSymbol[] {
  const characters = Array.from(word.text.trim())
  if (!characters.some((character) => /\d/.test(character))) return []

  const width = Math.max(1, word.bbox.x1 - word.bbox.x0)
  const digits: DigitSymbol[] = []
  characters.forEach((character, index) => {
    const normalized = normalizeOcrDigit(character)
    if (!/^\d$/.test(normalized)) return
    digits.push({
      text: normalized,
      confidence: word.confidence,
      bbox: {
        x0: word.bbox.x0 + (width * index) / characters.length,
        y0: word.bbox.y0,
        x1: word.bbox.x0 + (width * (index + 1)) / characters.length,
        y1: word.bbox.y1,
      },
    })
  })
  return digits
}

/** 一整行的數字，由左到右。 */
export function digitsOfLine(line: LineLike): DigitSymbol[] {
  return line.words.flatMap(digitsOfWord).sort((a, b) => a.bbox.x0 - b.bbox.x0)
}

/** 標準 Luhn 檢查，**外加 13–19 碼的長度限制**（信用卡卡號的範圍）。 */
export function passesLuhn(value: string): boolean {
  if (value.length < 13 || value.length > 19) return false
  if (!/^\d+$/.test(value)) return false
  let sum = 0
  let double = false
  for (let index = value.length - 1; index >= 0; index--) {
    let digit = Number(value[index])
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

/** 把一組數字符號接成字串。 */
export function joinDigits(digits: readonly DigitSymbol[]): string {
  return digits.map((digit) => digit.text).join('')
}

/** 數字的中心點是否落在允許保留的區域裡。 */
export function centerIn(box: Bbox, region: Bbox): boolean {
  const x = (box.x0 + box.x1) / 2
  const y = (box.y0 + box.y1) / 2
  return x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1
}
