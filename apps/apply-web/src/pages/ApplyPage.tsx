/** `/apply/:scheme` — SPEC §8.1 的六步送件流程。
 *
 * 一個 reducer 管全部狀態，草稿鏡到 sessionStorage（不含影像）。
 * 每一步只有一個主要動作，上一步永遠按得回去（SPEC §15.1）。
 */

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button, EmptyState, Spinner, Stepper } from '@maydru/ui'
import type { ApplicationFacts } from '@maydru/review-rules'
import { ChannelStep } from '../apply/ChannelStep'
import { ConfirmStep } from '../apply/ConfirmStep'
import { DocsStep } from '../apply/DocsStep'
import { GuideStep } from '../apply/GuideStep'
import { IdentityStep } from '../apply/IdentityStep'
import { ToolStep } from '../apply/ToolStep'
import { runPrecheck, type PrecheckView } from '../apply/precheck'
import {
  STEPS,
  STEP_KEYS,
  STEP_LEAD,
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
import { submitApplication, useRequiredDocuments, useScheme } from '../lib/queries'
import { terminateOcrWorker } from '../lib/ocrWorker'
import { ApiError } from '../lib/api'

export default function ApplyPage() {
  const { scheme: schemeCode = '' } = useParams()
  const navigate = useNavigate()
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
          id_last4: state.identity.id_last4.trim() || undefined,
          email: state.identity.email.trim() || undefined,
          tool_name: state.tool.name.trim(),
          tool_id: state.tool.tool_id,
          purchase_amount: Number(state.channel.purchase_amount),
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
      setSubmitError(
        cause instanceof ApiError
          ? cause.code === 'SCHEME_CLOSED'
            ? '這個方案的申請期間已經結束，無法再送件。'
            : cause.message
          : '送出時發生問題，請再試一次。',
      )
    } finally {
      setSubmitting(false)
    }
  }, [navigate, requiredCodes, scheme, schemeCode, state, view])

  if (schemeQuery.isLoading) return <Spinner label="載入方案資料…" />
  if (schemeQuery.error || !scheme)
    return (
      <EmptyState
        title="找不到這個補助方案"
        hint="連結可能過期了。請回到首頁重新選擇一個開放中的方案。"
        action={
          <Button variant="primary" onClick={() => navigate('/')}>
            回首頁
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
    <section className="md-risein space-y-5">
      <Stepper steps={STEPS} current={state.stepIndex} />

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{STEP_TITLE[stepKey]}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">{STEP_LEAD[stepKey]}</p>
      </header>

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

      <div className="flex gap-2 pt-2">
        {state.stepIndex > 0 && (
          <Button size="lg" icon={<ArrowLeft size={16} />} onClick={goBack}>
            上一步
          </Button>
        )}
        {stepKey !== 'confirm' && (
          <Button variant="primary" size="lg" block icon={<ArrowRight size={16} />} onClick={goNext}>
            下一步
          </Button>
        )}
      </div>
    </section>
  )
}
