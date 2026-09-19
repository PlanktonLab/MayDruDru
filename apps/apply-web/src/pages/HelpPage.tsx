import { Page, Placeholder } from './parts'

export default function HelpPage() {
  return (
    <Page title="常見問題" lead="關於申辦資格、應備文件、審核時間與個資處理的說明。">
      <Placeholder phase="P2 罐頭訊息" items={['常見問題清單', '聯絡承辦窗口', '個人資料如何被處理與刪除']} />
    </Page>
  )
}
