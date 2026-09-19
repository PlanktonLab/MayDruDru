/**
 * 方案編輯器（SPEC §6.2 / §8.2「方案管理」）。
 *
 * 上半是方案自己的欄位，下半是六張子設定表的分頁。兩邊都帶樂觀鎖：存檔時把載入時
 * 拿到的 `version` 一起送上去，對不上就回 409，畫面說的是「請重新載入」而不是
 * 一句「失敗」——使用者要知道的是「有人比你快」，不是「壞了」。
 *
 * 讀取開放給登入的承辦人（審案時常要回來確認這個方案怎麼設定的），寫入要 `admin`。
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, RotateCcw, Save } from 'lucide-react'
import { ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useInvalidate } from '../../lib/hooks'
import { Badge, Button, Card, Spinner, errMsg, useToast } from '../../components/ui'
import { Notice, PageHeader } from '../../components/admin/shared'
import { ChildTab, VERSION_CONFLICT, type Column } from './ChildTab'
import CopilotPanel from './CopilotPanel'
import RulesTab from './RulesTab'
import ToolsTab from './ToolsTab'
import { FieldGrid, type FieldSpec, type FormValues, type Option } from './fields'
import { fetchChildren, fetchPendingTools, fetchScheme, patchScheme } from './queries'
import { Chips } from '../../components/admin/TagInput'
import type {
  DocumentType, EligibleTool, PaymentChannel, RejectionCode, ReviewRuleRow, SchemeDetail, Tier,
} from './types'

const TABS = ['身分別', '文件類型', '繳費管道', '審核規則', '退件碼', '合格工具'] as const
type Tab = (typeof TABS)[number]

/** §6.2 的每一個可編輯欄位。少一個，承辦人員就得回去請工程師改資料庫（決策 D6）。 */
const SCHEME_SPECS: FieldSpec[] = [
  { name: 'name', label: '方案名稱', required: true, kind: 'text' },
  { name: 'category', label: '類別', hint: '例如 青年、育兒、就業', kind: 'text' },
  { name: 'description', label: '方案說明', wide: true, kind: 'textarea' },
  { name: 'eligibility', label: '申請資格', wide: true, kind: 'textarea' },
  { name: 'age_min', label: '年齡下限', kind: 'number', min: 0, max: 120 },
  { name: 'age_max', label: '年齡上限', kind: 'number', min: 0, max: 120 },
  { name: 'application_start', label: '申請開始日', hint: '留空＝沒有起始限制', kind: 'date' },
  { name: 'application_end', label: '申請截止日', hint: '留空＝沒有截止限制', kind: 'date' },
  { name: 'amount_note', label: '補助金額說明', kind: 'text' },
  { name: 'official_url', label: '官方網址', kind: 'text' },
  { name: 'contact', label: '聯絡方式', kind: 'text' },
  { name: 'application_method', label: '申請方式', wide: true, kind: 'textarea' },
  { name: 'tags', label: '標籤', hint: '方案卡片上的分類標籤', kind: 'tags' },
  { name: 'identity_tags', label: '身分標籤', hint: '用來比對民眾的身分別', kind: 'tags' },
  { name: 'required_documents', label: '文件清單（給民眾看的文字）', wide: true, kind: 'tags' },
  { name: 'residency_requirement', label: '設籍要求', kind: 'text' },
  { name: 'student_requirement', label: '學生身分', kind: 'select',
    options: [{ value: 'any', label: '不限' }, { value: 'required', label: '必須是學生' }, { value: 'excluded', label: '不可為學生' }] },
  { name: 'employment_requirement', label: '就業狀態', kind: 'select',
    options: [{ value: 'any', label: '不限' }, { value: 'employed', label: '必須在職' }, { value: 'unemployed', label: '必須待業' }] },
  { name: 'retention_days', label: '文件保存天數', hint: '案件結案後幾天硬刪證明文件（預設 90）', kind: 'number', min: 1, max: 3650 },
  { name: 'supplement_days', label: '補件期限（天）', hint: '退件時預設給民眾幾天（預設 14）', kind: 'number', min: 1, max: 365 },
  { name: 'max_revisions', label: '最多補正次數', hint: '超過就只能駁回，不能再退件補正', kind: 'number', min: 0, max: 20 },
  { name: 'active', label: '收件中', hint: '關掉之後民眾就看不到、也送不進來', kind: 'bool' },
]

const TIER_SPECS = (docs: Option[]): FieldSpec[] => [
  { name: 'code', label: '身分別代碼', hint: '例如 GENERAL、LOW_INCOME', required: true, kind: 'text' },
  { name: 'label', label: '顯示名稱', required: true, kind: 'text' },
  { name: 'subsidy_rate', label: '補助比率', hint: '0.5 代表補助一半', kind: 'number', min: 0, max: 1, step: 0.05 },
  { name: 'cap_amount', label: '補助上限（元）', kind: 'number', min: 0 },
  { name: 'required_proof_doc_types', label: '額外要附的證明文件', kind: 'multi', options: docs },
]

const DOC_SPECS: FieldSpec[] = [
  { name: 'code', label: '文件代碼', required: true, kind: 'text' },
  { name: 'label', label: '顯示名稱', required: true, kind: 'text' },
  { name: 'hint', label: '給民眾的提示', wide: true, kind: 'textarea' },
  { name: 'required', label: '一定要附', kind: 'bool' },
  { name: 'required_when', label: '什麼情況下才要附', hint: '只在沒有勾「一定要附」時生效', kind: 'select',
    options: [{ value: '', label: '看繳費管道與身分別' }, { value: 'proxy', label: '由他人代付時' }] },
  { name: 'must_mask', label: '上傳前必須遮蔽', hint: '例如帳單要遮卡號；勾了民眾就一定會進遮罩編輯器', kind: 'bool' },
  { name: 'keep_visible', label: '遮蔽時必須留著的欄位', hint: '例如「末四碼與金額」', kind: 'text' },
  { name: 'keep_after_disbursed', label: '撥款後仍保留', hint: '不隨保存期限一起硬刪', kind: 'bool' },
  { name: 'accepted_mime', label: '可接受的檔案格式', hint: '例如 image/png、application/pdf', wide: true, kind: 'tags' },
  { name: 'max_pages', label: '最多幾頁', kind: 'number', min: 1, max: 50 },
]

const CHANNEL_SPECS = (docs: Option[]): FieldSpec[] => [
  { name: 'code', label: '管道代碼', required: true, kind: 'select',
    options: ['CREDIT_CARD', 'TELECOM', 'E_PAYMENT', 'OTHER'].map((v) => ({ value: v, label: v })) },
  { name: 'label', label: '顯示名稱', required: true, kind: 'text' },
  { name: 'hint', label: '提示', wide: true, kind: 'textarea' },
  { name: 'required_document_type_codes', label: '這個管道必附的文件', kind: 'multi', options: docs },
  { name: 'guide_content_key', label: '準備指引的文案 key', hint: '例如 apply.guide.credit_card', kind: 'text' },
]

const REJECTION_SPECS = (docs: Option[]): FieldSpec[] => [
  { name: 'code', label: '退件碼', required: true, kind: 'text' },
  { name: 'staff_label', label: '承辦人看的說法', hint: '決策列上勾選時看到的字', required: true, kind: 'text' },
  { name: 'public_what_wrong', label: '民眾看的：哪裡不對', wide: true, kind: 'textarea' },
  { name: 'public_how_to_fix', label: '民眾看的：怎麼修', hint: '說「怎麼修」與「去哪修」，不要只說錯了', wide: true, kind: 'textarea' },
  { name: 'related_document_type_codes', label: '相關文件', kind: 'multi', options: docs },
  { name: 'related_sop_flow_ids', label: '相關 SOP flow id', hint: '退件推播的「教我準備」會連到它', wide: true, kind: 'tags' },
  { name: 'active', label: '啟用', kind: 'bool' },
]

export default function SchemeEditorPage() {
  const { code = '' } = useParams()
  const { can } = useAuth()
  const canWrite = can('admin')
  const toast = useToast()
  const invalidate = useInvalidate()
  const [tab, setTab] = useState<Tab>('身分別')
  const [form, setForm] = useState<FormValues>({})
  const [busy, setBusy] = useState(false)
  const [stale, setStale] = useState(false)

  const scheme = useQuery({ queryKey: ['scheme', code], queryFn: () => fetchScheme(code), enabled: !!code })
  const children = useQuery({
    queryKey: ['scheme-children', code],
    enabled: !!code,
    queryFn: async () => ({
      tiers: await fetchChildren<Tier>(code, 'tiers'),
      documentTypes: await fetchChildren<DocumentType>(code, 'document-types'),
      channels: await fetchChildren<PaymentChannel>(code, 'payment-channels'),
      rules: await fetchChildren<ReviewRuleRow>(code, 'review-rules'),
      rejections: await fetchChildren<RejectionCode>(code, 'rejection-codes'),
      tools: await fetchChildren<EligibleTool>(code, 'eligible-tools'),
      pending: await fetchPendingTools(code),
    }),
  })

  useEffect(() => {
    if (scheme.data) { setForm({ ...(scheme.data as unknown as FormValues) }); setStale(false) }
  }, [scheme.data])

  const reloadChildren = () => { void invalidate('scheme-children') }
  const reloadAll = () => { void invalidate('scheme', 'scheme-children', 'schemes') }

  const docOptions: Option[] = useMemo(
    () => (children.data?.documentTypes ?? []).map((d) => ({ value: d.code, label: d.label || d.code })),
    [children.data],
  )

  const save = async () => {
    const detail = scheme.data as SchemeDetail | undefined
    if (!detail) return
    setBusy(true)
    try {
      const body = Object.fromEntries(SCHEME_SPECS.map((s) => [s.name, form[s.name]]))
      await patchScheme(code, { ...body, expected_version: detail.version })
      reloadAll()
      toast('已儲存')
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { setStale(true); toast(VERSION_CONFLICT, 'err') }
      else toast(errMsg(e), 'err')
    } finally { setBusy(false) }
  }

  if (scheme.isLoading || children.isLoading) {
    return <div className="flex items-center gap-2 p-6 text-sm text-muted"><Spinner /> 載入中…</div>
  }
  if (scheme.error) return <div className="p-6"><Notice tone="warn">{errMsg(scheme.error)}</Notice></div>
  const detail = scheme.data as SchemeDetail
  const data = children.data

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title={detail.name}
        description={<span className="font-mono text-[11px]">{detail.code}</span>}
        actions={
          <>
            <Link to="/schemes"><Button size="sm" variant="ghost"><ChevronLeft size={13} /> 回清單</Button></Link>
            <Badge tone="muted">版本 {detail.version}</Badge>
            {detail.active ? <Badge tone="good">收件中</Badge> : <Badge tone="muted">已關閉</Badge>}
          </>
        }
      />

      {stale && (
        <Notice tone="warn">
          這個方案剛剛被其他人改過了，你看到的不是最新版本。
          <Button size="sm" variant="ghost" className="ml-2" onClick={reloadAll}><RotateCcw size={13} /> 重新載入</Button>
        </Notice>
      )}

      <Card
        title="基本資料"
        actions={canWrite && <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}><Save size={13} /> 儲存基本資料</Button>}
      >
        <FieldGrid specs={SCHEME_SPECS} values={form} disabled={!canWrite || busy}
                   onChange={(name, v) => setForm((f) => ({ ...f, [name]: v }))} />
      </Card>

      <CopilotPanel code={code} canWrite={canWrite} />

      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={tab === t
              ? 'border-b-2 border-accent px-3 py-2 text-sm font-medium text-accent'
              : 'border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-primary'}
          >
            {t}
          </button>
        ))}
      </div>

      {data && tab === '身分別' && (
        <ChildTab<Tier>
          code={code} kind="tiers" rows={data.tiers} specs={TIER_SPECS(docOptions)}
          columns={[
            { label: '代碼', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
            { label: '名稱', render: (r) => r.label },
            { label: '補助比率', render: (r) => `${Math.round((r.subsidy_rate || 0) * 100)}%` },
            { label: '上限', render: (r) => (r.cap_amount || 0).toLocaleString('zh-TW') },
            { label: '額外證明', render: (r) => <Chips items={r.required_proof_doc_types ?? []} /> },
          ] as Column<Tier>[]}
          blank={{ code: '', label: '', subsidy_rate: 0.5, cap_amount: 0, required_proof_doc_types: [] }}
          canWrite={canWrite} reload={reloadChildren}
          addLabel="新增身分別" empty="這個方案還沒有身分別，所有人會用同一組補助條件。"
        />
      )}

      {data && tab === '文件類型' && (
        <ChildTab<DocumentType>
          code={code} kind="document-types" rows={data.documentTypes} specs={DOC_SPECS}
          columns={[
            { label: '代碼', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
            { label: '名稱', render: (r) => r.label },
            { label: '必附', render: (r) => (r.required ? <Badge tone="accent">一定要附</Badge>
              : r.required_when === 'proxy' ? <Badge tone="warn">代付時</Badge> : <Badge tone="muted">看情況</Badge>) },
            { label: '遮蔽', render: (r) => (r.must_mask ? <Badge tone="danger">必須遮蔽</Badge> : '—') },
            { label: '格式', render: (r) => <Chips items={r.accepted_mime ?? []} /> },
            { label: '頁數上限', render: (r) => r.max_pages },
          ] as Column<DocumentType>[]}
          blank={{ code: '', label: '', hint: '', required: false, required_when: '', must_mask: false,
                   keep_visible: '', keep_after_disbursed: false, accepted_mime: ['image/png', 'image/jpeg'], max_pages: 5 }}
          canWrite={canWrite} reload={reloadChildren}
          addLabel="新增文件類型" empty="這個方案還沒有文件類型，民眾送件時不會被要求上傳任何東西。"
        />
      )}

      {data && tab === '繳費管道' && (
        <ChildTab<PaymentChannel>
          code={code} kind="payment-channels" rows={data.channels} specs={CHANNEL_SPECS(docOptions)}
          columns={[
            { label: '代碼', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
            { label: '名稱', render: (r) => r.label },
            { label: '必附文件', render: (r) => <Chips items={r.required_document_type_codes ?? []} /> },
            { label: '指引文案', render: (r) => <span className="font-mono text-[11px]">{r.guide_content_key || '—'}</span> },
          ] as Column<PaymentChannel>[]}
          blank={{ code: 'CREDIT_CARD', label: '', hint: '', required_document_type_codes: [], guide_content_key: '' }}
          canWrite={canWrite} reload={reloadChildren}
          addLabel="新增繳費管道" empty="這個方案還沒有繳費管道。"
        />
      )}

      {data && tab === '審核規則' && (
        <RulesTab code={code} rules={data.rules} docTypes={data.documentTypes}
                  canWrite={canWrite} reload={reloadChildren} />
      )}

      {data && tab === '退件碼' && (
        <ChildTab<RejectionCode>
          code={code} kind="rejection-codes" rows={data.rejections} specs={REJECTION_SPECS(docOptions)}
          columns={[
            { label: '代碼', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
            { label: '承辦人看的說法', render: (r) => r.staff_label },
            { label: '民眾看的：哪裡不對', render: (r) => <span className="text-xs">{r.public_what_wrong || '—'}</span> },
            { label: '相關文件', render: (r) => <Chips items={r.related_document_type_codes ?? []} /> },
            { label: '相關 SOP', render: (r) => <Chips items={r.related_sop_flow_ids ?? []} /> },
            { label: '啟用', render: (r) => (r.active ? <Badge tone="good">啟用</Badge> : <Badge tone="muted">停用</Badge>) },
          ] as Column<RejectionCode>[]}
          blank={{ code: '', staff_label: '', public_what_wrong: '', public_how_to_fix: '',
                   related_document_type_codes: [], related_sop_flow_ids: [], active: true }}
          canWrite={canWrite} reload={reloadChildren}
          addLabel="新增退件碼" empty="這個方案還沒有退件碼，承辦人員退件時沒有理由可以勾。"
        />
      )}

      {data && tab === '合格工具' && (
        <ToolsTab code={code} tools={data.tools} pending={data.pending}
                  canWrite={canWrite} reload={reloadChildren} />
      )}
    </div>
  )
}
