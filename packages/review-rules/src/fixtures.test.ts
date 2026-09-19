/** 掃過 `fixtures/*.json` 的每一個案例。
 *
 * Python 版（`services/review.py`）會載入同一批檔案跑同一組斷言——這個測試的
 * 比對語意就是兩版之間的契約，改動前請先讀 `fixtures/README.md`。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { evaluate, precheck } from './engine'
import type { ApplicationFacts, Finding, OcrDocument, ReviewRule, Verdict } from './types'

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures', import.meta.url))

interface Fixture {
  name: string
  description: string
  rules: ReviewRule[]
  documents: OcrDocument[]
  facts: ApplicationFacts
  expected: { findings: Partial<Finding>[]; verdict: Verdict }
}

const files = readdirSync(FIXTURE_DIR)
  .filter((file) => file.endsWith('.json'))
  .sort()

describe('共用 fixtures', () => {
  it('找得到 fixture，而且涵蓋四種 rule_type', () => {
    expect(files.length).toBeGreaterThanOrEqual(12)
    const types = new Set<string>()
    for (const file of files) {
      const fixture = load(file)
      for (const rule of fixture.rules) types.add(rule.rule_type)
    }
    expect([...types].sort()).toEqual([
      'amount_tolerance',
      'keyword_extract',
      'regex_extract',
      'required_doc',
    ])
  })

  it('三種 verdict 都有案例', () => {
    const verdicts = new Set(files.map((file) => load(file).expected.verdict))
    expect([...verdicts].sort()).toEqual(['FAIL', 'INDETERMINATE', 'PASS'])
  })

  for (const file of files) {
    const fixture = load(file)
    it(`${file} — ${fixture.name}`, () => {
      const findings = evaluate(fixture.rules, fixture.documents, fixture.facts)
      const result = precheck(findings, fixture.rules)

      expect(findings.map((item) => item.rule_code)).toEqual(
        fixture.expected.findings.map((item) => item.rule_code),
      )
      fixture.expected.findings.forEach((expectedFinding, index) => {
        expectFindingMatches(findings[index], expectedFinding, `${file}#${index}`)
      })
      expect(result.verdict, file).toBe(fixture.expected.verdict)
    })
  }
})

function load(file: string): Fixture {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as Fixture
}

/**
 * 部分比對：只看 fixture 裡有寫的欄位；`null` 與「不存在」視為相同
 * （所以 `"suggested_supplement": null` 等於「不該有補件建議」）。
 */
function expectFindingMatches(actual: Finding, expected: Partial<Finding>, where: string): void {
  for (const [key, want] of Object.entries(expected)) {
    const got = (actual as unknown as Record<string, unknown>)[key]
    if (want === null || want === undefined) {
      expect(got ?? null, `${where}.${key}`).toBeNull()
      continue
    }
    expect(got, `${where}.${key}`).toEqual(want)
  }
}
