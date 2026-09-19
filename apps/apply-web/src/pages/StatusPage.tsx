import { Page, Placeholder } from './parts'

export default function StatusPage() {
  return (
    <Page
      title="查詢進度"
      lead="輸入案件編號與當初填寫的手機號碼，就能看到目前的審核狀態；需要補件時也從這裡上傳。"
    >
      <Placeholder phase="P3 案件狀態" items={['案件時間軸與目前狀態', '退件原因與應補文件', '線上補件']} />
    </Page>
  )
}
