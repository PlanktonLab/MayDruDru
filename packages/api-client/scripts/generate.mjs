#!/usr/bin/env node
/**
 * 從執行中的 API 取 OpenAPI 文件，產生 `src/schema.d.ts`。
 *
 *   npm run generate -w @maydru/api-client                  # 取 http://localhost:8000/openapi.json
 *   npm run generate -w @maydru/api-client -- ./openapi.json # 讀本機檔案
 *   OPENAPI_URL=http://localhost:8200/openapi.json npm run generate -w @maydru/api-client
 *
 * 產出的 schema.d.ts 不進 git（見 .gitignore）：契約以後端的 OpenAPI 為準，
 * CI 會重新產生並比對是否有未同步的差異（SPEC §14）。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../src/schema.d.ts')
const arg = process.argv[2]
const url = process.env.OPENAPI_URL || 'http://localhost:8000/openapi.json'

async function loadSpec() {
  if (arg) {
    const path = resolve(process.cwd(), arg)
    console.log(`[api-client] 讀取本機 OpenAPI：${path}`)
    return JSON.parse(await readFile(path, 'utf8'))
  }
  console.log(`[api-client] 取得 OpenAPI：${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`取得 OpenAPI 失敗：${res.status} ${res.statusText}`)
  return await res.json()
}

const { default: openapiTS, astToString } = await import('openapi-typescript')
const spec = await loadSpec()
const ast = await openapiTS(spec)
const banner = '/* 自動產生，請勿手改。來源：apps/api 的 OpenAPI（npm run generate -w @maydru/api-client）。 */\n'
await writeFile(out, banner + astToString(ast), 'utf8')
console.log(`[api-client] 已寫入 ${out}`)
