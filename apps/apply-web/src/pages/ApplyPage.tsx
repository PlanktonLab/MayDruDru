import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button, Stepper } from '@maydru/ui'
import { MAX_LONG_EDGE } from '@maydru/ocr'
import { Page, Placeholder } from './parts'

/** SPEC §8.1 的 6 步；P3 會把每一步接上真正的畫面。 */
const STEPS = [
  { key: 'tool', label: '工具' },
  { key: 'identity', label: '身分' },
  { key: 'channel', label: '購買明細' },
  { key: 'guide', label: '準備' },
  { key: 'docs', label: '上傳' },
  { key: 'review', label: '送出' },
] as const

export default function ApplyPage() {
  const [step, setStep] = useState(0)

  return (
    <Page
      title="線上申辦"
      lead="不需要註冊或登入。備妥證明文件照片，依畫面指示一步一步完成，送出後會拿到一組案件編號。"
    >
      <Stepper steps={STEPS} current={step} />

      <Placeholder
        phase="P3 送件流程"
        items={[
          '選擇補助方案與申辦資格',
          `上傳證明文件：照片自動縮到長邊 ${MAX_LONG_EDGE}，敏感資訊在瀏覽器端遮掉`,
          '確認擷取到的欄位，送出並取得案件編號',
        ]}
      />

      <Button
        variant="primary"
        size="lg"
        block
        icon={<ArrowRight size={18} />}
        onClick={() => setStep((current) => (current + 1) % STEPS.length)}
      >
        下一步
      </Button>
    </Page>
  )
}
