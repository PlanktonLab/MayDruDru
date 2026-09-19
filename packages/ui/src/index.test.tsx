import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, Checkbox, Field, Input, Modal, Stepper, cssVar, cx } from './index'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('cx / cssVar', () => {
  it('合併 class 並丟掉假值', () => {
    const off = false as boolean
    expect(cx('a', off && 'b', undefined, null, 'c')).toBe('a c')
  })

  it('token 轉成 CSS 變數', () => {
    expect(cssVar('accent')).toBe('var(--accent)')
  })
})

describe('Button', () => {
  it('loading 時自動 disable 並標示 aria-busy', () => {
    render(
      <Button variant="primary" loading>
        送出申請
      </Button>,
    )
    const button = screen.getByRole('button', { name: /送出申請/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
  })

  it('disabled 時不會觸發 onClick', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        送出申請
      </Button>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('預設是 type="button"，不會誤送表單', () => {
    render(<Button>取消</Button>)
    expect(screen.getByRole('button')).toHaveProperty('type', 'button')
  })
})

describe('Field', () => {
  it('標籤與控制項綁在一起，錯誤訊息用 aria-describedby', () => {
    render(
      <Field label="手機號碼" error="請填 10 碼手機號碼，例如 0912345678" required>
        {(props) => <Input {...props} />}
      </Field>,
    )
    const input = screen.getByLabelText(/手機號碼/)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toContain('例如 0912345678')
  })
})

describe('Checkbox', () => {
  it('點文字也能勾選', () => {
    const onChange = vi.fn()
    render(<Checkbox label="我確認已遮住卡號" onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('我確認已遮住卡號'))
    expect(onChange).toHaveBeenCalled()
  })
})

describe('Modal', () => {
  function Host() {
    const [open, setOpen] = useState(true)
    return (
      <Modal open={open} onClose={() => setOpen(false)} title="確認撤回">
        <p>撤回後就不能再補件了。</p>
        <button type="button">我知道了</button>
      </Modal>
    )
  }

  it('Esc 會呼叫 onClose', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="確認撤回">
        <p>內容</p>
      </Modal>,
    )
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc 之後對話框真的關起來', () => {
    render(<Host />)
    const dialog = screen.getByRole('dialog') as HTMLDialogElement
    expect(dialog.open).toBe(true)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(dialog.open).toBe(false)
  })

  it('關閉鈕有中文的無障礙標籤', () => {
    render(
      <Modal open onClose={vi.fn()} title="確認撤回">
        <p>內容</p>
      </Modal>,
    )
    expect(screen.getByRole('button', { name: '關閉' })).toBeTruthy()
  })
})

describe('Stepper', () => {
  const steps = [
    { key: 'tool', label: '工具' },
    { key: 'identity', label: '身分' },
    { key: 'docs', label: '上傳' },
  ]

  it('目前這步標上 aria-current，之前的步驟打勾', () => {
    const { container } = render(<Stepper steps={steps} current={1} />)
    expect(screen.getByText('身分').getAttribute('aria-current')).toBe('step')
    expect(screen.getByText('工具').getAttribute('aria-current')).toBeNull()
    // 第一步已完成 → 顯示勾而不是數字「1」
    expect(container.textContent).not.toContain('1第')
    expect(screen.getByText('第 2 / 3 步 · 身分')).toBeTruthy()
  })

  it('最後一步不會超出範圍', () => {
    render(<Stepper steps={steps} current={5} />)
    expect(screen.getByText('第 3 / 3 步 · 上傳')).toBeTruthy()
  })
})
