import { Page, Placeholder } from './parts'

export default function SopPage() {
  return (
    <Page
      title="教我準備"
      lead="不確定證明文件要去哪裡下載？這裡用一步一張圖的方式帶你操作，和 LINE 上的教學是同一份內容。"
    >
      <Placeholder phase="P4 SOP 導引" items={['依文件類型挑選教學', '逐步圖卡與重點標註', '卡住時可直接轉到 LINE 詢問']} />
    </Page>
  )
}
