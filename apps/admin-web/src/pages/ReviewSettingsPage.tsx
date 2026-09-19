/** `/review-settings` — ProReview 的「資料重點設定」工作入口。
 *
 * 規則仍是方案資料的一部分；這頁只把承辦人的工作流程拉到第一層導覽，不複製資料、
 * 不另開 API。實際編輯與試算共用方案管理的 RulesTab，避免兩個設定畫面日後走樣。
 */

import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, FileCheck2, Settings2 } from 'lucide-react'
import { Badge, Button, Card, Select, Spinner } from '@maydru/ui'
import { useAuth } from '../lib/auth'
import { errMsg } from '../components/ui'
import { Notice, PageHeader } from '../components/admin/shared'
import RulesTab from './schemes/RulesTab'
import { fetchChildren, fetchSchemes } from './schemes/queries'
import type { DocumentType, ReviewRuleRow } from './schemes/types'

export default function ReviewSettingsPage() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const schemes = useQuery({ queryKey: ['schemes'], queryFn: fetchSchemes })
  const requested = params.get('scheme') ?? ''
  const selectedCode = schemes.data?.some((scheme) => scheme.code === requested)
    ? requested
    : (schemes.data?.[0]?.code ?? '')

  useEffect(() => {
    if (selectedCode && selectedCode !== requested) setParams({ scheme: selectedCode }, { replace: true })
  }, [requested, selectedCode, setParams])

  const settings = useQuery({
    queryKey: ['review-settings', selectedCode],
    enabled: Boolean(selectedCode),
    queryFn: async () => {
      const [documentTypes, rules] = await Promise.all([
        fetchChildren<DocumentType>(selectedCode, 'document-types'),
        fetchChildren<ReviewRuleRow>(selectedCode, 'review-rules'),
      ])
      return { documentTypes, rules }
    },
  })

  const summary = useMemo(() => {
    const rules = settings.data?.rules ?? []
    return {
      active: rules.filter((rule) => rule.active).length,
      required: rules.filter((rule) => rule.active && rule.required).length,
      coveredDocuments: new Set(rules.filter((rule) => rule.active && rule.document_type_code).map((rule) => rule.document_type_code)).size,
    }
  }, [settings.data])

  const selectedScheme = schemes.data?.find((scheme) => scheme.code === selectedCode)

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 px-6 py-8">
      <PageHeader
        title="資料重點設定"
        description="設定每個方案要從哪些文件找哪些資料；案件審核時會直接標出命中的位置，交由承辦人確認。"
        actions={
          <Link to={selectedCode ? `/cases?scheme=${encodeURIComponent(selectedCode)}` : '/cases'}>
            <Button variant="primary"><FileCheck2 size={14} /> 前往案件審核</Button>
          </Link>
        }
      />

      <Card title="選擇方案" actions={selectedScheme && <Badge tone={selectedScheme.active ? 'good' : 'neutral'}>{selectedScheme.active ? '收件中' : '已關閉'}</Badge>}>
        {schemes.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> 載入方案…</div>
        ) : schemes.error ? (
          <Notice tone="warn">{errMsg(schemes.error)}</Notice>
        ) : !schemes.data?.length ? (
          <Notice tone="warn">尚未建立方案，請先到「方案設定」新增方案與文件類型。</Notice>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-72 flex-1 flex-col gap-1 text-[13px] text-muted">
              要設定哪一個方案
              <Select
                aria-label="要設定哪一個方案"
                value={selectedCode}
                onChange={(event) => setParams({ scheme: event.target.value })}
              >
                {schemes.data.map((scheme) => <option key={scheme.id} value={scheme.code}>{scheme.name}（{scheme.code}）</option>)}
              </Select>
            </label>
            {selectedCode && (
              <Link to={`/schemes/${encodeURIComponent(selectedCode)}`}>
                <Button><Settings2 size={14} /> 完整方案設定 <ArrowRight size={14} /></Button>
              </Link>
            )}
          </div>
        )}
      </Card>

      {settings.isLoading && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> 載入資料重點…</div>}
      {settings.error && <Notice tone="warn">{errMsg(settings.error)}</Notice>}
      {settings.data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="資料重點摘要">
            <Card title="啟用中的重點"><div className="text-2xl font-semibold tabular-nums">{summary.active}</div></Card>
            <Card title="核定前必須確認"><div className="text-2xl font-semibold tabular-nums">{summary.required}</div></Card>
            <Card title="已有重點的文件類型"><div className="text-2xl font-semibold tabular-nums">{summary.coveredDocuments} / {settings.data.documentTypes.length}</div></Card>
          </div>
          <Notice tone="muted">
            「必要規則」若尚未由系統或人工判定為符合，案件不能核定。修改後可在下方用虛構 OCR 文字試算，不會讀取正式案件文件。
          </Notice>
          <RulesTab
            code={selectedCode}
            rules={settings.data.rules}
            docTypes={settings.data.documentTypes}
            canWrite={can('admin')}
            reload={() => void settings.refetch()}
          />
        </>
      )}
    </div>
  )
}
