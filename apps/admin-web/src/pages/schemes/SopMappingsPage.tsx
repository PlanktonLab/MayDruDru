/** 方案 × 文件類型 × 平台的 SOP flow 對照（SPEC §8.2 / §8.5）。 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'
import { useCanvas } from '../../lib/hooks'
import { Empty, Spinner, errMsg, useToast } from '../../components/ui'
import { Notice, PageHeader, Table, Td, Th } from '../../components/admin/shared'
import {
  fetchChildren,
  fetchSchemes,
  fetchSopFlowLinks,
  replaceSopFlowLinks,
  type SopFlowLink,
} from './queries'
import type { DocumentType, SchemeRow } from './types'

function MappingRow({ scheme, documentType }: { scheme: string; documentType: DocumentType }) {
  const canvas = useCanvas()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState('')
  const links = useQuery({
    queryKey: ['sop-mappings', scheme, documentType.code],
    queryFn: () => fetchSopFlowLinks(scheme, documentType.code),
  })
  const platforms = canvas.data?.platforms ?? []
  const published = canvas.data?.flows.filter((flow) => flow.status === 'published') ?? []

  const change = async (platformId: string, flowId: string) => {
    const existing = links.data ?? []
    const next = existing
      .filter((row) => row.platform_id !== platformId)
      .map((row) => ({ flow_id: row.flow_id, platform_id: row.platform_id }))
    if (flowId) next.push({ flow_id: flowId, platform_id: platformId })
    setSaving(platformId)
    try {
      await replaceSopFlowLinks(scheme, documentType.code, next)
      await queryClient.invalidateQueries({ queryKey: ['sop-mappings', scheme, documentType.code] })
      toast('文件教學對照已儲存', 'ok')
    } catch (error) {
      toast(errMsg(error), 'err')
    } finally {
      setSaving('')
    }
  }

  return (
    <tr>
      <Td>
        <div className="font-medium text-primary">{documentType.label || documentType.code}</div>
        <div className="font-mono text-[11px] text-muted">{documentType.code}</div>
      </Td>
      {platforms.map((platform) => {
        const selected = links.data?.find((row: SopFlowLink) => row.platform_id === platform.id)?.flow_id ?? ''
        const options = published.filter((flow) => flow.platform_id === platform.id)
        return (
          <Td key={platform.id}>
            <select aria-label={`${documentType.label || documentType.code}・${platform.display_name}`}
              value={selected} disabled={links.isLoading || saving === platform.id}
              onChange={(event) => void change(platform.id, event.target.value)}
              className="min-h-9 w-full min-w-40 rounded-lg border border-border bg-background px-2 text-xs">
              <option value="">不指定</option>
              {options.map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
            </select>
          </Td>
        )
      })}
    </tr>
  )
}

export default function SopMappingsPage() {
  const schemes = useQuery({ queryKey: ['schemes'], queryFn: fetchSchemes })
  const [scheme, setScheme] = useState('')
  const selectedScheme = scheme || schemes.data?.[0]?.code || ''
  const documents = useQuery({
    queryKey: ['scheme-children', selectedScheme, 'document-types'],
    queryFn: () => fetchChildren<DocumentType>(selectedScheme, 'document-types'),
    enabled: Boolean(selectedScheme),
  })
  const canvas = useCanvas()
  const platforms = canvas.data?.platforms ?? []

  return (
    <div className="space-y-4 p-6">
      <PageHeader title="文件類型對照" description="指定每一份文件在各平台要開啟哪條已發布 SOP。未發布的流程不會出現在選單裡。" />
      <label className="block max-w-md text-sm font-medium text-primary">
        方案
        <select aria-label="方案" value={selectedScheme} onChange={(event) => setScheme(event.target.value)}
          className="mt-1.5 min-h-10 w-full rounded-lg border border-border bg-background px-3">
          {(schemes.data ?? []).map((row: SchemeRow) => <option key={row.code} value={row.code}>{row.name}（{row.code}）</option>)}
        </select>
      </label>

      {(schemes.isLoading || documents.isLoading || canvas.isLoading) && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> 載入中…</div>}
      {(schemes.error || documents.error || canvas.error) && <Notice tone="warn">{errMsg(schemes.error || documents.error || canvas.error)}</Notice>}
      {documents.data && !documents.data.length && <Empty>這個方案還沒有文件類型</Empty>}
      {documents.data && documents.data.length > 0 && !platforms.length && <Empty>還沒有 SOP 平台，請先到流程頁新增平台。</Empty>}

      {documents.data && documents.data.length > 0 && platforms.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <thead><tr><Th className="min-w-52">文件類型</Th>{platforms.map((platform) => <Th key={platform.id} className="min-w-48">{platform.display_name}</Th>)}</tr></thead>
            <tbody>{documents.data.map((documentType) => <MappingRow key={documentType.id} scheme={selectedScheme} documentType={documentType} />)}</tbody>
          </Table>
        </div>
      )}
      <Notice><span className="inline-flex items-center gap-2"><Link2 size={14} />市民端與 LINE 只會讀取已發布流程；草稿不會外流。</span></Notice>
    </div>
  )
}
