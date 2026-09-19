/**
 * 審核規則編輯器與試算面板（SPEC §8.2「規則編輯器：四種 rule_type 表單」、§8.3）。
 *
 * 規則是純設定（決策 D6），所以這裡的表單是照 `rule_type` 換的四組欄位，不是一個
 * 「請貼 JSON」的輸入框——承辦人員要能在不知道 JSON 是什麼的情況下改一條規則。
 *
 * 試算面板做的是一件很具體的事：貼一段 OCR 文字（或挑一個範例），在**瀏覽器裡**用
 * `@maydru/review-rules` 跑一次，立刻看到每條規則判成什麼。想確認伺服器也這麼想，
 * 再按「與伺服器對一次」——那一支跑的是 `services/review.py`。兩邊不一致就是規則
 * 引擎的兩個實作走鐘了，這正是 SPEC §14「規則一致性」要擋的事。
 */

import { useMemo, useState } from 'react'
import { evaluate, precheck, type Finding, type ReviewRule } from '@maydru/review-rules'
import type { OcrResult } from '@maydru/ocr'
import { Badge, Button, Card, Field, Input, Select, Textarea, errMsg, useToast } from '../../components/ui'
import { Notice, Table, Td, Th } from '../../components/admin/shared'
import { ChildTab, type Column } from './ChildTab'
import type { FieldSpec, Option } from './fields'
import { evaluateRules } from './queries'
import type { DocumentType, EvaluateResult, ReviewRuleRow, RuleType } from './types'

export const RULE_TYPE_LABEL: Record<RuleType, string> = {
  keyword_extract: '找關鍵字抽值',
  regex_extract: '全文 regex 抽值',
  amount_tolerance: '金額容差比對',
  required_doc: '必要文件齊備',
}

const RULE_TYPE_HINT: Record<RuleType, string> = {
  keyword_extract: '在指定文件的每一行找關鍵字，命中後（可選）再用 regex 抽出值。',
  regex_extract: '對整份文件的文字跑一次 regex，取指定的 group。',
  amount_tolerance: '拿另一條規則抽到的金額，跟申請書上的申報金額比。',
  required_doc: '檢查這幾種文件都收到了；沒設定就看方案自己算出來的必要文件。',
}

const STATUS_TONE: Record<string, 'good' | 'danger' | 'warn' | 'muted'> = {
  MATCH: 'good', MISMATCH: 'danger', UNREADABLE: 'warn', PENDING: 'muted',
}

const VERDICT_TEXT: Record<string, string> = {
  PASS: '通過：沒有需要人看的項目',
  FAIL: '擋下：有必填規則判為不符',
  INDETERMINATE: '待確認：有判不出來的項目，不擋送出',
}

/** 貼進來的文字 → OCR 結果。一行一個 line，bbox 是合成的等高矩形。 */
export function textToOcr(text: string, confidence = 90): OcrResult {
  const lines = text.split('\n')
  return {
    text,
    confidence,
    lines: lines.map((line, i) => ({
      text: line,
      confidence,
      bbox: { x0: 0, y0: 20 * i, x1: 400, y1: 20 * i + 18 },
      words: [],
    })),
  }
}

/** 三個現成的例子，讓面板一打開就有東西可以按。 */
export const FIXTURES: { id: string; label: string; document_type_code: string; text: string; amount: number }[] = [
  {
    id: 'billing-ok', label: '信用卡帳單（金額看得到）', document_type_code: 'BILLING_STATEMENT',
    text: '消費明細\n新臺幣 1,200\n卡號 ****1234\n扣款日 2026/09/01', amount: 1200,
  },
  {
    id: 'billing-mismatch', label: '信用卡帳單（金額對不上）', document_type_code: 'BILLING_STATEMENT',
    text: '消費明細\n新臺幣 3,800\n卡號 ****1234\n扣款日 2026/09/01', amount: 1200,
  },
  {
    id: 'blurry', label: '看不清楚的帳單', document_type_code: 'BILLING_STATEMENT',
    text: '消費明細\n金額 ▮▮▮▮\n卡號 ****1234', amount: 1200,
  },
]

/* ------------------------------------------------------------ 規則表單 */

const BASE_SPECS = (docTypes: Option[]): FieldSpec[] => [
  { name: 'code', label: '規則代碼', hint: '英數與底線，例如 BILLING_TWD_AMOUNT', required: true, kind: 'text' },
  { name: 'label', label: '規則名稱', hint: '一句話說它在確認什麼', required: true, kind: 'text' },
  { name: 'document_type_code', label: '看哪一種文件', hint: '留空＝所有文件一起找',
    kind: 'select', options: [{ value: '', label: '（不限文件）' }, ...docTypes] },
  { name: 'rule_type', label: '規則類型', kind: 'select',
    options: (Object.keys(RULE_TYPE_LABEL) as RuleType[]).map((t) => ({ value: t, label: RULE_TYPE_LABEL[t] })) },
  { name: 'required', label: '必要規則（核准前必須判為符合）', kind: 'bool' },
  { name: 'active', label: '啟用', kind: 'bool' },
  { name: 'severity', label: '嚴重程度', hint: 'error＋必要＝不符時擋住送出', kind: 'select',
    options: [{ value: 'error', label: '錯誤（擋住）' }, { value: 'warning', label: '警告（放行但標記）' }] },
]

/** 四種 rule_type 各自的 config 欄位（SPEC §8.3 的表格）。 */
export function configSpecs(ruleType: RuleType, docTypes: Option[], ruleCodes: Option[]): FieldSpec[] {
  const normalize: FieldSpec = {
    name: 'config.normalize', label: '抽到的值怎麼正規化', wide: false, kind: 'select',
    options: [
      { value: '', label: '（原樣）' },
      { value: 'amount', label: '金額' },
      { value: 'date', label: '日期' },
      { value: 'last4', label: '末四碼' },
    ],
  }
  switch (ruleType) {
    case 'keyword_extract':
      return [
        { name: 'config.keywords', label: '關鍵字', hint: '任何一個命中就算；拉丁字母的優先', required: true, wide: true, kind: 'tags' },
        { name: 'config.value_after_keyword', label: '取關鍵字後面的字當值', kind: 'bool' },
        { name: 'config.regex', label: '抽值 regex（可留空）', hint: String.raw`例如 [\d,]+ 只取數字`, kind: 'text' },
        { name: 'config.group', label: 'regex 的第幾個 group', kind: 'number', min: 0 },
        normalize,
      ]
    case 'regex_extract':
      return [
        { name: 'config.pattern', label: 'regex', hint: '對整份文件的文字跑一次', required: true, wide: true, kind: 'text' },
        { name: 'config.group', label: '取第幾個 group', kind: 'number', min: 0 },
        normalize,
      ]
    case 'amount_tolerance':
      return [
        { name: 'config.source_rule_code', label: '金額從哪一條規則來', required: true, kind: 'select',
          options: [{ value: '', label: '（請選擇）' }, ...ruleCodes] },
        { name: 'config.tolerance_pct', label: '容差百分比', hint: '5 代表 5%', kind: 'number', min: 0, max: 100 },
        { name: 'config.tolerance_abs', label: '容差金額（元）', hint: '百分比與金額兩個條件都要成立', kind: 'number', min: 0 },
      ]
    case 'required_doc':
      return [
        { name: 'config.document_type_codes', label: '必須收到的文件', hint: '不勾＝看方案自己算出來的必要文件',
          kind: 'multi', options: docTypes },
      ]
  }
}

/** `config.x` 的巢狀欄位在表單裡是平的；存檔前折回一個 config 物件。 */
export function foldConfig(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const config: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('config.')) {
      if (value !== '' && value !== null && value !== undefined) config[key.slice(7)] = value
    } else out[key] = value
  }
  out.config = config
  return out
}

export function unfoldConfig(row: Record<string, unknown>): Record<string, unknown> {
  const config = (row.config ?? {}) as Record<string, unknown>
  return { ...row, ...Object.fromEntries(Object.entries(config).map(([k, v]) => [`config.${k}`, v])) }
}

/* ------------------------------------------------------------ 試算面板 */

function FindingRows({ findings }: { findings: Pick<Finding, 'rule_code' | 'status' | 'extracted_value' | 'expected_value'>[] }) {
  return (
    <Table>
      <thead>
        <tr><Th>規則</Th><Th className="w-28">判定</Th><Th>抽到的值</Th><Th>期待的值</Th></tr>
      </thead>
      <tbody>
        {findings.map((f) => (
          <tr key={f.rule_code}>
            <Td className="font-mono text-xs">{f.rule_code}</Td>
            <Td><Badge tone={STATUS_TONE[f.status] ?? 'muted'}>{f.status}</Badge></Td>
            <Td className="text-xs">{f.extracted_value ?? '—'}</Td>
            <Td className="text-xs">{f.expected_value ?? '—'}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

export function TryOutPanel({ code, rules, docTypes }: {
  code: string
  rules: ReviewRuleRow[]
  docTypes: DocumentType[]
}) {
  const toast = useToast()
  const [text, setText] = useState(FIXTURES[0].text)
  const [docType, setDocType] = useState(FIXTURES[0].document_type_code)
  const [amount, setAmount] = useState<number>(FIXTURES[0].amount)
  const [server, setServer] = useState<EvaluateResult | null>(null)
  const [busy, setBusy] = useState(false)

  const engineRules: ReviewRule[] = useMemo(
    () => rules.map((r) => ({ ...r, document_type_code: r.document_type_code || null })),
    [rules],
  )
  const documents = useMemo(
    () => [{ document_type_code: docType, ocr: textToOcr(text) }],
    [docType, text],
  )
  const facts = useMemo(() => ({
    purchase_amount: Number.isFinite(amount) ? amount : null,
    tier_code: '', payment_channel_code: '', paid_by_proxy: false,
    required_document_type_codes: [] as string[],
  }), [amount])

  const findings = useMemo(() => evaluate(engineRules, documents, facts), [engineRules, documents, facts])
  const verdict = useMemo(() => precheck(findings, engineRules).verdict, [findings, engineRules])

  const compare = async () => {
    setBusy(true)
    setServer(null)
    try {
      const result = await evaluateRules(code, {
        rules: engineRules,
        documents: documents.map((d) => ({ document_type_code: d.document_type_code, ocr: d.ocr })),
        facts,
      })
      setServer(result)
    } catch (e) { toast(errMsg(e), 'err') } finally { setBusy(false) }
  }

  const agrees = server
    && server.verdict === verdict
    && server.findings.length === findings.length
    && server.findings.every((f, i) => f.status === findings[i].status && f.extracted_value === findings[i].extracted_value)

  return (
    <Card title="試算" actions={
      <Button size="sm" loading={busy} onClick={() => void compare()}>與伺服器對一次</Button>
    }>
      <div className="space-y-3">
        <Notice tone="muted">
          貼一段辨識出來的文字（或挑一個範例），下面會立刻用瀏覽器端的規則引擎跑一次。
          判定以伺服器為準，所以改完規則記得按右上角跟伺服器對一次。
        </Notice>
        <div className="flex flex-wrap gap-2">
          {FIXTURES.map((f) => (
            <Button key={f.id} size="sm" onClick={() => { setText(f.text); setDocType(f.document_type_code); setAmount(f.amount); setServer(null) }}>
              {f.label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="這段文字是哪一種文件">
            <Select value={docType} className="w-full" onChange={(e) => setDocType(e.target.value)}>
              <option value="">（不限文件）</option>
              {docTypes.map((d) => <option key={d.code} value={d.code}>{d.label || d.code}</option>)}
            </Select>
          </Field>
          <Field label="申請書上的申報金額" hint="金額容差規則會拿它來比">
            <Input type="number" value={String(amount)} onChange={(e) => setAmount(Number(e.target.value))} />
          </Field>
        </div>
        <Field label="辨識出來的文字">
          <Textarea rows={6} value={text} onChange={(e) => { setText(e.target.value); setServer(null) }}
                    aria-label="辨識出來的文字" className="font-mono text-xs" />
        </Field>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">瀏覽器判定</span>
          <Badge tone={verdict === 'PASS' ? 'good' : verdict === 'FAIL' ? 'danger' : 'warn'}>{verdict}</Badge>
          <span className="text-xs text-muted">{VERDICT_TEXT[verdict]}</span>
        </div>
        {!rules.length ? <Notice tone="warn">這個方案還沒有任何規則，試算不會判出東西。</Notice> : <FindingRows findings={findings} />}

        {server && (
          <Notice tone={agrees ? 'accent' : 'warn'}>
            {agrees
              ? `伺服器判的一樣（${server.verdict}）。`
              : `伺服器判的是 ${server.verdict}，和瀏覽器這一側不一致——這是規則引擎兩個實作走鐘的徵兆，請回報。`}
          </Notice>
        )}
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------ 分頁本體 */

export default function RulesTab({ code, rules, docTypes, canWrite, reload }: {
  code: string
  rules: ReviewRuleRow[]
  docTypes: DocumentType[]
  canWrite: boolean
  reload: () => void
}) {
  const [ruleType, setRuleType] = useState<RuleType>('keyword_extract')
  const docOptions: Option[] = docTypes.map((d) => ({ value: d.code, label: d.label || d.code }))
  const ruleOptions: Option[] = rules.map((r) => ({ value: r.code, label: `${r.code}（${r.label}）` }))

  const columns: Column<ReviewRuleRow>[] = [
    { label: '代碼', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { label: '名稱', render: (r) => r.label },
    { label: '文件', render: (r) => r.document_type_code || '不限' },
    { label: '類型', render: (r) => RULE_TYPE_LABEL[r.rule_type] ?? r.rule_type },
    {
      label: '判定',
      render: (r) => (
        <span className="flex gap-1">
          {r.required ? <Badge tone="accent">必要</Badge> : <Badge tone="muted">選用</Badge>}
          {r.severity === 'error' ? <Badge tone="danger">錯誤</Badge> : <Badge tone="warn">警告</Badge>}
          {!r.active && <Badge tone="muted">停用</Badge>}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <Notice tone="accent">
        這裡設定的「看哪份文件、找哪些關鍵字或格式」會隨方案設定送到申請頁；使用者上傳後只在瀏覽器執行 OCR 比對。找不到時只提示，不會把前端辨識當成最終審核結果。
      </Notice>
      <ChildTab<ReviewRuleRow>
        code={code}
        kind="review-rules"
        rows={rules}
        specs={[...BASE_SPECS(docOptions), ...configSpecs(ruleType, docOptions, ruleOptions)]}
        columns={columns}
        blank={{ code: '', label: '', document_type_code: '', rule_type: ruleType, required: true,
                 active: true, severity: 'error', 'config.value_after_keyword': true }}
        canWrite={canWrite}
        reload={reload}
        addLabel="新增規則（期望欄位）"
        empty="這個方案還沒有審核規則。沒有規則的案件只能純人工判讀。"
        toForm={(row) => unfoldConfig(row as unknown as Record<string, unknown>)}
        fromForm={foldConfig}
      >
        <Field label="要編輯哪一種規則的表單" hint={RULE_TYPE_HINT[ruleType]}>
          <Select value={ruleType} onChange={(e) => setRuleType(e.target.value as RuleType)} aria-label="規則類型表單">
            {(Object.keys(RULE_TYPE_LABEL) as RuleType[]).map((t) => (
              <option key={t} value={t}>{RULE_TYPE_LABEL[t]}</option>
            ))}
          </Select>
        </Field>
      </ChildTab>

      <TryOutPanel code={code} rules={rules} docTypes={docTypes} />
    </div>
  )
}
