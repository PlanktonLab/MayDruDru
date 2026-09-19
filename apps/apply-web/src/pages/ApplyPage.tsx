/** `/apply/:scheme` — SPEC §8.1 的六步送件流程。
 *
 * 一個 reducer 管全部狀態，草稿鏡到 sessionStorage（不含影像）。
 * 每一步只有一個主要動作，上一步永遠按得回去（SPEC §15.1）。
 */

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Inbox } from 'lucide-react'
import { Button, EmptyState, Spinner, Stepper } from '@maydru/ui'
import type { ApplicationFacts } from '@maydru/review-rules'
import { ChannelStep } from '../apply/ChannelStep'
import { ConfirmStep } from '../apply/ConfirmStep'
import { DocsStep } from '../apply/DocsStep'
import { GuideStep } from '../apply/GuideStep'
import { IdentityStep } from '../apply/IdentityStep'
import { ToolStep } from '../apply/ToolStep'
import { SummaryAside } from '../apply/SummaryAside'
import { runPrecheck, type PrecheckView } from '../apply/precheck'
import {
  STEPS,
  STEP_KEYS,
  STEP_TITLE,
  canLeave,
  channelErrors,
  clearDraft,
  identityErrors,
  initialState,
  loadDraft,
  missingDocuments,
  reducer,
  toolErrors,
} from '../apply/state'
import { submitApplication, useRequiredDocuments, useScheme, useSchemes } from '../lib/queries'
import { terminateOcrWorker } from '../lib/ocrWorker'
import { ApiError } from '../lib/api'

export default function ApplyPage() {
  // `/` 沒有方案代碼：目前只有一個補助計畫，所以進站就是它的申請流程，
  // 不再讓市民先在清單裡選一次（等於多一個沒有選項的選擇題）。
  // `/apply/:scheme` 仍然有效，未來多開一個方案時不必動這裡。
  const { scheme: routeCode } = useParams()
  const navigate = useNavigate()
  const schemesQuery = useSchemes()
  // 沒帶代碼時取第一個開放中的方案；伺服器已經只回開放中的。
  const schemeCode = routeCode ?? schemesQuery.data?.[0]?.code ?? ''
  const schemeQuery = useScheme(schemeCode)
  const scheme = schemeQuery.data

  const [state, dispatch] = useReducer(reducer, schemeCode, initialState)
  const [showErrors, setShowErrors] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // 草稿：回來時接續填，離開送件流程時把 OCR worker 收掉。
  useEffect(() => {
    const draft = loadDraft(schemeCode)
    if (draft) dispatch({ type: 'restore', draft })
  }, [schemeCode])
  useEffect(() => () => void terminateOcrWorker(), [])

  const requiredQuery = useRequiredDocuments(schemeCode, {
    tier_code: state.identity.tier_code,
    payment_channel_code: state.channel.payment_channel_code,
    paid_by_proxy: state.channel.paid_by_proxy,
  })
  const requiredCodes = useMemo(
    () => requiredQuery.data?.document_type_codes ?? [],
    [requiredQuery.data],
  )

  const stepKey = STEP_KEYS[state.stepIndex]

  const facts: ApplicationFacts = useMemo(
    () => ({
      purchase_amount: Number(state.channel.purchase_amount) || null,
      purchase_date: state.channel.purchase_date || null,
      tier_code: state.identity.tier_code,
      payment_channel_code: state.channel.payment_channel_code,
      paid_by_proxy: state.channel.paid_by_proxy,
      required_document_type_codes: requiredCodes,
    }),
    [state.channel, state.identity.tier_code, requiredCodes],
  )

  const uploaded = useMemo(() => Object.values(state.docs), [state.docs])

  const view: PrecheckView | null = useMemo(() => {
    if (!scheme || uploaded.length === 0) return null
    return runPrecheck({ scheme, docs: uploaded, facts })
  }, [scheme, uploaded, facts])

  const goNext = useCallback(() => {
    if (!canLeave(stepKey, state, scheme, requiredCodes)) {
      setShowErrors(true)
      return
    }
    setShowErrors(false)
    dispatch({ type: 'next' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [requiredCodes, scheme, state, stepKey])

  const goBack = useCallback(() => {
    setShowErrors(false)
    dispatch({ type: 'back' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const submit = useCallback(async () => {
    if (!scheme) return
    setSubmitError('')
    setSubmitting(true)
    try {
      const documents = requiredCodes
        .map((code) => state.docs[code])
        .filter(Boolean)
        .map((doc) => ({
          document_type_code: doc.document_type_code,
          masked: doc.masked,
          mime: doc.mime,
          page_count: doc.page_count,
          ocr: doc.ocr,
          blob: doc.blob,
          fileName: `${doc.document_type_code}.jpg`,
        }))
      const result = await submitApplication(
        {
          scheme_code: scheme.code,
          tier_code: state.identity.tier_code,
          payment_channel_code: state.channel.payment_channel_code,
          applicant_name: state.identity.applicant_name.trim(),
          phone: state.identity.phone.trim(),
          id_number: state.identity.id_number.trim().toUpperCase() || undefined,
          email: state.identity.email.trim() || undefined,
          tool_name: state.tool.name.trim(),
          tool_id: state.tool.tool_id,
          // 後端的 purchase_amount 是整數，小數點會被 422 擋下來。
          purchase_amount: Math.round(Number(state.channel.purchase_amount)),
          purchase_date: state.channel.purchase_date,
          paid_by_proxy: state.channel.paid_by_proxy,
          note: state.manualAssist ? '申請人勾選「請人工協助審核」。' : undefined,
          precheck: view ? { verdict: view.verdict, findings: view.findings } : undefined,
        },
        documents,
      )
      clearDraft(schemeCode)
      navigate(`/apply/${encodeURIComponent(schemeCode)}/done?case=${encodeURIComponent(result.case_no)}`, {
        replace: true,
      })
    } catch (cause) {
      // `lib/api.ts` 已經把機器代碼翻成「怎麼修」，這裡直接用那句話。
      setSubmitError(cause instanceof ApiError ? cause.message : '送出時發生問題，請再試一次。')
    } finally {
      setSubmitting(false)
    }
  }, [navigate, requiredCodes, scheme, schemeCode, state, view])

  // 首頁要先問到方案代碼才問得到方案本身，兩段載入都算「載入中」。
  if (schemeQuery.isLoading || (!routeCode && schemesQuery.isLoading)) return <Spinner label="載入方案資料…" />

  // 首頁而且一個開放中的方案都沒有：這不是壞掉，是目前沒有可申請的東西。
  if (!routeCode && !schemeCode)
    return (
      <EmptyState
        icon={<Inbox size={20} />}
        title="目前沒有開放中的方案"
        hint="新的補助公告後會出現在這裡。你仍然可以用案件編號查詢先前送出的案件。"
        action={
          <Button variant="primary" onClick={() => navigate('/status')}>
            查詢案件進度
          </Button>
        }
      />
    )

  if (schemeQuery.error || !scheme)
    return (
      <EmptyState
        title="找不到這個補助方案"
        hint="連結可能過期了，或這個方案已經結束收件。"
        action={
          <Button variant="primary" onClick={() => navigate('/status')}>
            查詢案件進度
          </Button>
        }
      />
    )

  const errors = showErrors
    ? stepKey === 'identity'
      ? identityErrors(state.identity)
      : stepKey === 'channel'
        ? channelErrors(state.channel)
        : stepKey === 'tool'
          ? toolErrors(state, scheme)
          : {}
    : {}

  const missing = missingDocuments(requiredCodes, state.docs)

  return (
    <section className="md-risein">
      {/* 桌面：標題在左、步驟列在右的同一橫列；手機：步驟列在標題上面一行。 */}
      <div className="apply-flow-header mb-5 flex flex-col gap-4 lg:mb-7">
        {/* 標題是整件事的名字，不是目前這一步——步驟名在面板裡。
            一路上標題與副標都不變，人才知道自己還在同一件事情裡面。 */}
        <header>
          <h1 className="text-xl font-semibold tracking-tight lg:text-[20px]">
            AI領航青年數位工具補助計畫申請
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            選擇申請工具，依序完成資料與文件上傳。
          </p>
        </header>
        <Stepper steps={STEPS} current={state.stepIndex} />
      </div>

      <div className="apply-grid">
        <div className="apply-panel min-w-0 space-y-5">
          {/* 面板自己的標題 + 「01 / 06」計數：步驟列告訴你整條路，這一行告訴你站在哪。 */}
          <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
            <h2 className="text-[17px] font-semibold tracking-tight text-primary lg:text-[19px]">
              {STEP_TITLE[stepKey]}
            </h2>
            <span className="shrink-0 text-[12px] tabular-nums text-muted">
              {String(state.stepIndex + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
            </span>
          </div>

          {stepKey === 'tool' && (
            <ToolStep
              scheme={scheme}
              value={state.tool}
              error={errors.tool}
              onChange={(tool) => dispatch({ type: 'tool', tool })}
            />
          )}
          {stepKey === 'identity' && (
            <IdentityStep
              scheme={scheme}
              value={state.identity}
              errors={errors}
              onChange={(patch) => dispatch({ type: 'identity', patch })}
            />
          )}
          {stepKey === 'channel' && (
            <ChannelStep
              scheme={scheme}
              value={state.channel}
              errors={errors}
              onChange={(patch) => dispatch({ type: 'channel', patch })}
            />
          )}
          {stepKey === 'guide' && (
            <GuideStep scheme={scheme} requiredCodes={requiredCodes} loading={requiredQuery.isLoading} />
          )}
          {stepKey === 'docs' && (
            <DocsStep
              scheme={scheme}
              requiredCodes={requiredCodes}
              docs={state.docs}
              problemsByDoc={view?.problemsByDoc ?? {}}
              onDoc={(code, doc) => dispatch({ type: 'doc', code, doc })}
              onClear={(code) => dispatch({ type: 'dropDoc', code })}
            />
          )}
          {stepKey === 'confirm' && (
            <ConfirmStep
              scheme={scheme}
              state={state}
              requiredCodes={requiredCodes}
              view={view}
              submitting={submitting}
              error={submitError}
              onManualAssist={(value) => dispatch({ type: 'manualAssist', value })}
              onSubmit={() => void submit()}
            />
          )}

          {showErrors && stepKey === 'docs' && missing.length > 0 && (
            <p role="alert" className="text-[13px] leading-5 text-danger">
              還有 {missing.length} 份必備文件沒有上傳。把上面標示 * 的卡片都補齊就能繼續。
            </p>
          )}

          {/* 一個畫面一個主要動作：「下一步」佔滿剩下的寬度，「上一步」縮成一顆
              只有箭頭的方鈕——回得去，但不跟主要動作搶注意力。 */}
          <div className="flex min-w-0 gap-3 pt-2">
            {state.stepIndex > 0 && (
              <Button size="lg" aria-label="上一步" onClick={goBack} className="w-[52px] shrink-0 px-0">
                <ArrowLeft size={16} aria-hidden />
              </Button>
            )}
            {stepKey !== 'confirm' && (
              <Button variant="primary" size="lg" block onClick={goNext}>
                下一步
                <ArrowRight size={16} aria-hidden />
              </Button>
            )}
          </div>
        </div>

        {/* 摘要只在桌面出現；手機的同一份資訊在確認步驟完整列一次。 */}
        <div className="hidden lg:block">
          <SummaryAside scheme={scheme} state={state} requiredCodes={requiredCodes} />
        </div>
      </div>
    </section>
  )
}
