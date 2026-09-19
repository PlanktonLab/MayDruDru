import { Page, Placeholder } from './parts'

export default function ApplyPage() {
  return (
    <Page
      title="線上申辦"
      lead="不需要註冊或登入。備妥證明文件照片，依畫面指示一步一步完成，送出後會拿到一組案件編號。"
    >
      <Placeholder
        phase="P3 送件流程"
        items={[
          '選擇補助方案與申辦資格',
          '上傳證明文件並在瀏覽器端遮住敏感資訊',
          '確認擷取到的欄位，送出並取得案件編號',
        ]}
      />
    </Page>
  )
}
