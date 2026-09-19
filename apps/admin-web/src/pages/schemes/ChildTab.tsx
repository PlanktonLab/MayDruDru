/**
 * 子設定表的通用分頁：一張表、一個新增鈕、每列上下移／編輯／刪除（SPEC §8.2）。
 *
 * 級距、文件類型、繳費管道、退件碼四張表的差別只有「欄位」與「表格要顯示哪幾欄」，
 * 所以它們共用這個元件，各自只給規格。審核規則與合格工具有自己的分頁——前者要
 * 依 rule_type 換表單並附試算面板，後者要處理待審佇列，兩者都不是「多幾個欄位」
 * 而已。
 *
 * 樂觀鎖：每次存檔都帶那一列的 `expected_version`，撞到 409 時說的是「請重新載入」
 * 而不是一句「失敗」——使用者需要知道的是「有人比你快」，不是「壞了」。
 */

import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { ApiError } from '../../lib/api'
import { Button, Empty, Modal, confirm, errMsg, useToast } from '../../components/ui'
import { Table, Td, Th } from '../../components/admin/shared'
import { FieldGrid, missingFields, type FieldSpec, type FormValues } from './fields'
import { createChild, deleteChild, patchChild, reorderChildren } from './queries'
import type { ChildKind } from './types'

export const VERSION_CONFLICT = '這筆設定剛剛被其他人改過了，請重新載入後再編輯一次。'

/** 一個動作跑完會說一句話；409 有自己的說法。 */
export function useRunner(reload: () => void) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, ok: string): Promise<boolean> => {
    setBusy(true)
    try {
      await fn()
      reload()
      toast(ok)
      return true
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? VERSION_CONFLICT : errMsg(e), 'err')
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

export interface Column<T> { label: string; render: (row: T) => ReactNode; className?: string }

interface Row { id: string; version: number }

export function ChildTab<T extends Row>({
  code, kind, rows, specs, columns, blank, canWrite, reload, addLabel, empty, children,
  toForm, fromForm,
}: {
  code: string
  kind: ChildKind
  rows: T[]
  specs: FieldSpec[]
  columns: Column<T>[]
  blank: FormValues
  canWrite: boolean
  reload: () => void
  addLabel: string
  empty: string
  children?: ReactNode
  /** 資料列 → 表單值。審核規則用它把 `config` 攤平成 `config.xxx` 欄位。 */
  toForm?: (row: T) => FormValues
  /** 表單值 → 送出的 body。審核規則用它把 `config.xxx` 折回一個 config 物件。 */
  fromForm?: (values: FormValues) => Record<string, unknown>
}) {
  const toast = useToast()
  const { busy, run } = useRunner(reload)
  const [editing, setEditing] = useState<T | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<FormValues>({})

  const open = (row: T | null) => {
    setEditing(row)
    setAdding(row === null)
    setForm(row ? (toForm ? toForm(row) : ({ ...row } as unknown as FormValues)) : { ...blank })
  }
  const close = () => { setEditing(null); setAdding(false) }

  const save = async () => {
    const missing = missingFields(specs, form)
    if (missing.length) { toast(`還有必填欄位沒填：${missing.join('、')}`, 'err'); return }
    const picked = Object.fromEntries(specs.map((s) => [s.name, form[s.name]]))
    const body = fromForm ? fromForm(picked) : picked
    const ok = editing
      ? await run(() => patchChild(code, kind, editing.id, { ...body, expected_version: editing.version }), '已儲存')
      : await run(() => createChild(code, kind, body), '已新增')
    if (ok) close()
  }

  const remove = async (row: T) => {
    const yes = await confirm({ title: '刪除這一列設定？', body: '刪掉之後送件流程就不會再看到它。', action: '刪除', danger: true })
    if (yes !== true) return
    await run(() => deleteChild(code, kind, row.id), '已刪除')
  }

  const move = async (index: number, delta: number) => {
    const next = index + delta
    if (next < 0 || next >= rows.length) return
    const ids = rows.map((r) => r.id)
    ;[ids[index], ids[next]] = [ids[next], ids[index]]
    await run(() => reorderChildren(code, kind, ids), '已調整順序')
  }

  return (
    <div className="space-y-3">
      {children}
      {canWrite && (
        <div className="flex justify-end">
          <Button size="sm" variant="primary" onClick={() => open(null)}><Plus size={13} /> {addLabel}</Button>
        </div>
      )}
      {!rows.length ? <Empty>{empty}</Empty> : (
        <Table>
          <thead>
            <tr>
              {columns.map((c) => <Th key={c.label} className={c.className}>{c.label}</Th>)}
              {canWrite && <Th className="w-36 text-right">操作</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id} className="hover:bg-background-lite">
                {columns.map((c) => <Td key={c.label} className={c.className}>{c.render(row)}</Td>)}
                {canWrite && (
                  <Td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" disabled={busy || index === 0}
                            aria-label={`上移 ${row.id}`} title="上移" onClick={() => void move(index, -1)}>
                      <ArrowUp size={13} />
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy || index === rows.length - 1}
                            aria-label={`下移 ${row.id}`} title="下移" onClick={() => void move(index, 1)}>
                      <ArrowDown size={13} />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`編輯 ${row.id}`} onClick={() => open(row)}>
                      <Pencil size={13} /> 編輯
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`刪除 ${row.id}`} onClick={() => void remove(row)}>
                      <Trash2 size={13} />
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal open={adding || !!editing} onClose={close} width={640}
             title={adding ? addLabel : '編輯設定'}
             subtitle={adding ? undefined : '存檔時會檢查版本，有人比你先改過就會請你重新載入。'}>
        <FieldGrid specs={specs} values={form} disabled={busy}
                   onChange={(name, v) => setForm((f) => ({ ...f, [name]: v }))} />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>取消</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>儲存</Button>
        </div>
      </Modal>
    </div>
  )
}
