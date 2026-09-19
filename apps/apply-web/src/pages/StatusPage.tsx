import { Timeline, type TimelineEvent } from '@maydru/ui'
import { Page, Placeholder } from './parts'

/** P0 只示範時間軸的樣子；真正的事件在 P3 從 `/api/apply/cases/:case_no` 取得。 */
const SHAPE: TimelineEvent[] = [
  { key: 'SUBMITTED', title: '已收件', description: '承辦人員會依送件順序開始審核。', tone: 'accent' },
  { key: 'UNDER_REVIEW', title: '審核中' },
  { key: 'APPROVED', title: '已核定' },
]

export default function StatusPage() {
  return (
    <Page
      title="查詢進度"
      lead="輸入案件編號與當初填寫的手機號碼，就能看到目前的審核狀態；需要補件時也從這裡上傳。"
    >
      <Timeline events={SHAPE} currentKey="SUBMITTED" />
      <Placeholder phase="P3 案件狀態" items={['案件時間軸與目前狀態', '退件原因與應補文件', '線上補件']} />
    </Page>
  )
}
