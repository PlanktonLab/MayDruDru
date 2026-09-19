/** 卡號自動偵測（SPEC §8.1 第 2 步：tesseract.js + Luhn）。
 *
 * 目標只有一個：**除了末四碼，畫面上其他數字全部遮掉**。
 * 找不到唯一一組通過 Luhn 的卡號時就誠實說「請手動遮」，絕不假裝遮好了。
 *
 * 自 submit-flow `lib/creditCardOcr.ts` 搬遷，改成 tesseract.js v6。
 */

import { PSM, createWorker, type Worker } from 'tesseract.js'
import {
  centerIn,
  digitsOfLine,
  joinDigits,
  passesLuhn,
  type Bbox,
  type DigitSymbol,
  type LineLike,
} from './luhn'
import type { MaskRect } from './mask'

export interface CardOcrResult {
  masks: MaskRect[]
  cardNumber: string
  cardholderName: string
  expiryDate: string
  last4: string
  /** 可以保留、不必遮的區域（末四碼每個字的框）。 */
  allowedRegions: Bbox[]
}

/** 偵測不到唯一卡號時丟出；訊息本身就是給市民看的「辨識摘要」。 */
export class CardOcrDetectionError extends Error {
  readonly detectedNumbers: string[]
  readonly cardholderName: string
  readonly expiryDate: string

  constructor(message: string, detectedNumbers: string[] = [], cardholderName = '', expiryDate = '') {
    super(message)
    this.name = 'CardOcrDetectionError'
    this.detectedNumbers = detectedNumbers
    this.cardholderName = cardholderName
    this.expiryDate = expiryDate
  }
}

/** 卡面只有英數字，所以只載 `eng`——比 chi_tra + eng 快得多。 */
export async function createCardOcrWorker(onProgress?: (progress: number) => void): Promise<Worker> {
  const worker = await createWorker('eng', undefined, {
    logger(message) {
      if (message.status === 'recognizing text') onProgress?.(message.progress)
    },
  })
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
    preserve_interword_spaces: '1',
  })
  return worker
}

interface BlockLike {
  paragraphs?: { lines?: LineLike[] | null }[] | null
}

function linesOf(blocks: BlockLike[] | null | undefined): LineLike[] {
  const lines: LineLike[] = []
  for (const block of blocks ?? [])
    for (const paragraph of block?.paragraphs ?? []) for (const line of paragraph?.lines ?? []) lines.push(line)
  return lines
}

function textOf(line: LineLike): string {
  return line.words
    .map((word) => word.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 反白一份副本：深色卡面配淺色壓印字時，反白後往往才讀得到。 */
function invertedCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return canvas
  context.drawImage(source, 0, 0)
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = 255 - image.data[index]
    image.data[index + 1] = 255 - image.data[index + 1]
    image.data[index + 2] = 255 - image.data[index + 2]
  }
  context.putImageData(image, 0, 0)
  return canvas
}

const IGNORED_NAME_WORDS =
  /\b(?:valid|thru|mastercard|visa|amex|american express|jcb|unionpay|biometric|debit|credit|expires?|month|year)\b/i

/** 從行文字猜有效期限與持卡人姓名——只用來顯示，不影響遮罩。 */
export function debugFieldsOf(lines: LineLike[]): { cardholderName: string; expiryDate: string } {
  const texts = lines.map(textOf).filter(Boolean)
  const expiryFromText =
    texts
      .map((text) => text.match(/(?:^|\s)(0?[1-9]|1[0-2])\s*[/.-]\s*(\d{2}|\d{4})(?:\s|$)/))
      .find(Boolean)?.[0]
      ?.trim() ?? ''
  const expiryDigits = lines
    .map((line) => joinDigits(digitsOfLine(line)))
    .find((value) => /^\d{4}$/.test(value) && Number(value.slice(0, 2)) >= 1 && Number(value.slice(0, 2)) <= 12)
  const expiryDate = expiryFromText || (expiryDigits ? `${expiryDigits.slice(0, 2)}/${expiryDigits.slice(2)}` : '')

  const cardholderName =
    texts
      .filter(
        (text) =>
          !/\d/.test(text) && !IGNORED_NAME_WORDS.test(text) && (text.match(/[A-Za-z]/g)?.length ?? 0) >= 4,
      )
      .sort((a, b) => (b.match(/[A-Za-z]/g)?.length ?? 0) - (a.match(/[A-Za-z]/g)?.length ?? 0))[0] ?? ''

  return { cardholderName, expiryDate }
}

/** 把一個數字的框加上內距、夾回畫布範圍，再正規化成 0–1。 */
export function paddedMask(box: Bbox, width: number, height: number): MaskRect {
  const characterHeight = Math.max(1, box.y1 - box.y0)
  const padX = Math.max(3, characterHeight * 0.2)
  const padY = Math.max(3, characterHeight * 0.15)
  const x0 = Math.max(0, box.x0 - padX)
  const y0 = Math.max(0, box.y0 - padY)
  const x1 = Math.min(width, box.x1 + padX)
  const y1 = Math.min(height, box.y1 + padY)
  return {
    x: x0 / width,
    y: y0 / height,
    w: (x1 - x0) / width,
    h: (y1 - y0) / height,
    source: 'AUTO',
    label: '自動遮蔽數字',
  }
}

async function readLines(worker: Worker, canvas: HTMLCanvasElement): Promise<LineLike[]> {
  // rotateAuto 關掉：自動轉正會讓 OCR 的框不再是來源 canvas 的座標，遮罩就會錯位。
  const { data } = await worker.recognize(canvas, { rotateAuto: false }, { blocks: true })
  return linesOf(data.blocks as BlockLike[] | null)
}

/**
 * 找出唯一通過 Luhn 的卡號，回傳「除末四碼外所有數字」的遮罩。
 *
 * 三輪辨識：
 *   1. `PSM.AUTO` 讀整張卡；
 *   2. 候選不是剛好一組時，改用**反白副本**再讀一次；
 *   3. `PSM.SPARSE_TEXT` 補抓零散的有效期限／安全碼小字（只加遮罩與補欄位，不改判定）。
 *
 * 還是湊不出唯一一組 → 丟 `CardOcrDetectionError`，交給市民手動遮。
 */
export async function detectCardMasks(worker: Worker, canvas: HTMLCanvasElement): Promise<CardOcrResult> {
  let lines = await readLines(worker, canvas)
  let digitGroups = lines.map(digitsOfLine)
  let candidates = digitGroups.filter((digits) => passesLuhn(joinDigits(digits)))
  let debug = debugFieldsOf(lines)

  if (candidates.length !== 1) {
    const inverted = invertedCanvas(canvas)
    lines = await readLines(worker, inverted)
    digitGroups = lines.map(digitsOfLine)
    candidates = digitGroups.filter((digits) => passesLuhn(joinDigits(digits)))
    const invertedDebug = debugFieldsOf(lines)
    debug = {
      cardholderName: invertedDebug.cardholderName || debug.cardholderName,
      expiryDate: invertedDebug.expiryDate || debug.expiryDate,
    }
    inverted.width = 0
    inverted.height = 0
  }

  let sparseLines: LineLike[] = []
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
    sparseLines = await readLines(worker, canvas)
    const sparseDebug = debugFieldsOf(sparseLines)
    debug = {
      cardholderName: debug.cardholderName || sparseDebug.cardholderName,
      expiryDate: debug.expiryDate || sparseDebug.expiryDate,
    }
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
  }

  if (candidates.length !== 1) {
    const detectedNumbers = digitGroups
      .map(joinDigits)
      .filter((value) => value.length >= 13 && value.length <= 19)
    const summary = digitGroups
      .map(joinDigits)
      .filter(Boolean)
      .map((value) => `${value.length} 碼／Luhn ${passesLuhn(value) ? '通過' : '未通過'}`)
      .join('、')
    throw new CardOcrDetectionError(
      summary || '未辨識到數字',
      detectedNumbers,
      debug.cardholderName,
      debug.expiryDate,
    )
  }

  const pan = candidates[0]
  const keep = new Set<DigitSymbol>(pan.slice(-4))
  const keepRegions = pan.slice(-4).map((digit) => digit.bbox)
  const allDigits = [...digitGroups.flat(), ...sparseLines.flatMap(digitsOfLine)]
  const masks = allDigits
    .filter((digit) => !keep.has(digit) && !keepRegions.some((region) => centerIn(digit.bbox, region)))
    .map((digit) => paddedMask(digit.bbox, canvas.width, canvas.height))

  return {
    masks,
    cardNumber: joinDigits(pan),
    cardholderName: debug.cardholderName,
    expiryDate: debug.expiryDate,
    last4: joinDigits(pan.slice(-4)),
    allowedRegions: keepRegions,
  }
}

export interface MaskVerification {
  safe: boolean
  extraDigits: string
  /** 只是資訊：OCR 讀不回孤立的末四碼很常見，最終仍以市民肉眼確認為準。 */
  last4Visible: boolean
}

/** 對遮罩後的圖再 OCR 一次，確認末四碼以外沒有讀得到的數字。 */
export async function verifyCardMask(
  worker: Worker,
  canvas: HTMLCanvasElement,
  result: CardOcrResult,
): Promise<MaskVerification> {
  const inspect = (lines: LineLike[]): MaskVerification => {
    const digits = lines.flatMap(digitsOfLine)
    const outside = digits.filter(
      (digit) => !result.allowedRegions.some((region) => centerIn(digit.bbox, region)),
    )
    const retained = digits
      .filter((digit) => result.allowedRegions.some((region) => centerIn(digit.bbox, region)))
      .sort((a, b) => a.bbox.x0 - b.bbox.x0)
    return {
      safe: outside.length === 0,
      extraDigits: joinDigits(outside),
      last4Visible: joinDigits(retained) === result.last4,
    }
  }

  let verification = inspect(await readLines(worker, canvas))
  if (!verification.safe) {
    const inverted = invertedCanvas(canvas)
    const invertedVerification = inspect(await readLines(worker, inverted))
    inverted.width = 0
    inverted.height = 0
    if (invertedVerification.safe || (!verification.last4Visible && invertedVerification.last4Visible))
      verification = invertedVerification
  }
  return verification
}
