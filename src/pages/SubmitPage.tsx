import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { LIMITS, validateSubmission, type FieldName, type SubmissionFields } from '../../supabase/functions/_shared/validation.ts'
import { ExhibitView } from '../components/ExhibitView.tsx'
import { TextField } from '../components/TextField.tsx'
import { Turnstile } from '../components/Turnstile.tsx'
import { useApp } from '../lib/app-context.ts'
import { PhotoError, preparePhoto, type PreparedPhoto } from '../lib/image-prep.ts'
import { useDocumentTitle } from '../lib/use-document-title.ts'

type Errors = Partial<Record<FieldName | 'photo', string>>
type Step = 'edit' | 'preview'

const EMPTY: SubmissionFields = { title: '', story: '', authorName: '', keptSince: '', imageAlt: '', consent: false }
const ACCEPT = 'image/jpeg,image/png,image/webp'

export type SubmitPageProps = {
  /** Для тестов: подмена подготовки фото (в jsdom нет canvas). */
  prepare?: (file: File) => Promise<PreparedPhoto>
  newId?: () => string
}

export function SubmitPage({ prepare = preparePhoto, newId = () => crypto.randomUUID() }: SubmitPageProps) {
  const { api, config } = useApp()
  const navigate = useNavigate()
  useDocumentTitle('Добавить вещь')

  // Всё хранится только в памяти страницы: не в localStorage и не в аналитике.
  const [fields, setFields] = useState<SubmissionFields>(EMPTY)
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [step, setStep] = useState<Step>('edit')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [resetSignal, setResetSignal] = useState(0)
  const [honeypot, setHoneypot] = useState('')
  const [dragging, setDragging] = useState(false)
  // Сводка ошибок вверху формы появляется только после попытки перейти дальше.
  const [attempted, setAttempted] = useState(false)
  const submissionId = useRef(newId())
  const fileInput = useRef<HTMLInputElement>(null)
  const errorSummary = useRef<HTMLDivElement>(null)
  const previewHeading = useRef<HTMLHeadingElement>(null)
  const photoId = useId()

  const closed = config.mode === 'live' && !config.submissionsEnabled
  const needsTurnstile = config.mode === 'live' && !!config.turnstileSiteKey

  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl])

  function contentChanged() {
    // Новое содержимое → новый ключ идемпотентности. Повтор того же содержимого — тот же ключ.
    submissionId.current = newId()
  }

  function update<K extends keyof SubmissionFields>(key: K, value: SubmissionFields[K]) {
    setFields((f) => ({ ...f, [key]: value }))
    contentChanged()
    if (errors[key]) setErrors(({ [key]: _omit, ...rest }) => rest)
  }

  function validateOne(key: FieldName) {
    const r = validateSubmission(fields)
    const msg = r.ok ? undefined : r.errors[key]
    setErrors((e) => {
      const { [key]: _omit, ...rest } = e
      return msg ? { ...rest, [key]: msg } : rest
    })
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setPhotoBusy(true)
    setErrors(({ photo: _omit, ...rest }) => rest)
    try {
      const prepared = await prepare(file)
      setPhoto(prepared)
      setPhotoUrl(URL.createObjectURL(prepared.blob))
      contentChanged()
    } catch (e) {
      setErrors((er) => ({ ...er, photo: e instanceof PhotoError ? e.message : 'Не получилось открыть фото. Попробуй другое.' }))
    } finally {
      setPhotoBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  function toPreview(e: FormEvent) {
    e.preventDefault()
    setAttempted(true)
    const r = validateSubmission(fields)
    const next: Errors = r.ok ? {} : { ...r.errors }
    if (!photo) next.photo = 'Добавь фотографию вещи.'
    setErrors(next)
    if (Object.keys(next).length > 0) {
      requestAnimationFrame(() => errorSummary.current?.focus())
      return
    }
    setSendError(null)
    setStep('preview')
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0 })
      previewHeading.current?.focus()
    })
  }

  async function send() {
    if (!photo || sending) return
    if (needsTurnstile && !token) {
      setSendError('Пройди проверку «я не робот» ниже.')
      return
    }
    setSending(true)
    setSendError(null)
    const outcome = await api.submit({
      fields,
      photo: photo.blob,
      submissionId: submissionId.current,
      turnstileToken: token,
      honeypot,
    })
    setSending(false)

    if (outcome.kind === 'accepted' || outcome.kind === 'demo') {
      navigate('/submitted', { replace: true, state: { demo: outcome.kind === 'demo' } })
      return
    }
    // Токен Turnstile одноразовый — запрашиваем новый для следующей попытки.
    setResetSignal((n) => n + 1)
    if (outcome.fields && Object.keys(outcome.fields).length > 0) {
      setErrors(outcome.fields)
      setAttempted(true)
      setStep('edit')
      requestAnimationFrame(() => errorSummary.current?.focus())
      return
    }
    setSendError(outcome.message)
  }

  if (closed) {
    return (
      <div className="center-state">
        <h1>Приём новых вещей временно закрыт</h1>
        <p className="muted">Пока можно посмотреть экспонаты, которые уже есть в музее.</p>
        <Link to="/exhibit" className="btn btn-primary">
          Посмотреть экспонат
        </Link>
      </div>
    )
  }

  const errorList = Object.entries(errors).filter(([, v]) => v)

  if (step === 'preview' && photo && photoUrl) {
    const clean = validateSubmission(fields)
    const v = clean.ok ? clean.value : null
    return (
      <section className="submit-page" aria-labelledby="preview-title">
        <div className="submit-head">
          <p className="label">Шаг 2 из 2</p>
          <h1 id="preview-title" ref={previewHeading} tabIndex={-1}>
            Так экспонат будет выглядеть в музее
          </h1>
          <p className="muted">Проверь текст и фото. Если всё верно — отправляй.</p>
        </div>

        <div className="preview-frame">
          <div className="preview-bar">
            <span className="label">Предпросмотр</span>
            <button type="button" className="btn btn-small" onClick={() => setStep('edit')} disabled={sending}>
              Вернуться к редактированию
            </button>
          </div>
          {v && (
            <ExhibitView
              headingLevel={2}
              numberLabel="Экспонат № —"
              exhibit={{
                number: null,
                title: v.title,
                story: v.story,
                authorName: v.authorName,
                keptSince: v.keptSince,
                imageAlt: v.imageAlt,
                imageUrl: photoUrl,
                imageWidth: photo.width,
                imageHeight: photo.height,
              }}
            />
          )}
        </div>

        <div className="send-panel">
          {config.mode === 'demo' && (
            <p className="notice notice-demo">
              <strong>Демо-версия.</strong> Кнопка ниже покажет, как работает отправка, но ничего не сохранит.
            </p>
          )}
          {needsTurnstile && config.mode === 'live' && (
            <Turnstile siteKey={config.turnstileSiteKey!} action="submit_exhibit" onToken={setToken} resetSignal={resetSignal} />
          )}
          {sendError && (
            <p className="notice notice-error" role="alert">
              {sendError}
            </p>
          )}
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={send} disabled={sending} aria-busy={sending}>
              {sending ? 'Отправляем…' : sendError ? 'Попробовать ещё раз' : config.mode === 'demo' ? 'Отправить (тест)' : 'Отправить в музей'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setStep('edit')} disabled={sending}>
              Изменить
            </button>
          </div>
          <p className="field-hint" role="status" aria-live="polite">
            {sending && 'Отправляем фото и историю. Это может занять несколько секунд.'}
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="submit-page" aria-labelledby="submit-title">
      <div className="submit-head">
        <p className="label">Шаг 1 из 2</p>
        <h1 id="submit-title">Добавить свою вещь</h1>
        <p className="muted">
          Одна фотография и короткая история. Вещь появится в музее после проверки.
        </p>
        <p className="notice notice-info">
          <strong>Не загружай документы, адреса, контакты и чужие личные данные.</strong>
        </p>
      </div>

      <form className="form" onSubmit={toPreview} noValidate>
        {attempted && errorList.length > 0 && (
          <div className="notice notice-error" role="alert" tabIndex={-1} ref={errorSummary}>
            <strong>Проверь, пожалуйста:</strong>
            <ul>
              {errorList.map(([k, v]) => (
                <li key={k}>{v}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 1. Фото */}
        <div className="field">
          <span className="field-label" id={`${photoId}-label`}>
            Фотография вещи
          </span>
          <p className="field-hint" id={`${photoId}-hint`}>
            JPEG, PNG или WebP, до 10 МБ. Обрезать не нужно — фото покажем целиком.
          </p>
          <div
            className="photo-drop"
            data-invalid={!!errors.photo}
            data-dragging={dragging}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              void onFile(e.dataTransfer.files[0])
            }}
          >
            {photo && photoUrl ? (
              <div className="photo-preview">
                <img src={photoUrl} alt="Выбранная фотография" />
                <div className="photo-preview-info">
                  <span>
                    Фото готово: {photo.width} × {photo.height} px
                  </span>
                  <span className="muted">Метаданные (EXIF, геолокация) будут удалены.</span>
                </div>
              </div>
            ) : (
              <p className="muted">Перетащи фото сюда или выбери файл.</p>
            )}
            <input
              ref={fileInput}
              id={photoId}
              type="file"
              accept={ACCEPT}
              className="visually-hidden"
              aria-labelledby={`${photoId}-label`}
              aria-describedby={`${photoId}-hint${errors.photo ? ` ${photoId}-error` : ''}`}
              aria-invalid={errors.photo ? true : undefined}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <div className="actions">
              <button type="button" className="btn btn-small" onClick={() => fileInput.current?.click()} disabled={photoBusy}>
                {photo ? 'Заменить фото' : 'Выбрать фото'}
              </button>
              {photoBusy && (
                <span className="loading" role="status">
                  Готовим фото…
                </span>
              )}
            </div>
          </div>
          {errors.photo && (
            <p className="field-error" id={`${photoId}-error`}>
              {errors.photo}
            </p>
          )}
        </div>

        <TextField
          label="Название"
          name="title"
          value={fields.title}
          onChange={(v) => update('title', v)}
          onBlur={() => fields.title && validateOne('title')}
          max={LIMITS.title.max}
          placeholder="Например, чашка с отбитой ручкой"
          error={errors.title}
        />

        <TextField
          label="Почему ты хранишь эту вещь?"
          name="story"
          multiline
          value={fields.story}
          onChange={(v) => update('story', v)}
          onBlur={() => fields.story && validateOne('story')}
          max={LIMITS.story.max}
          hint={`От ${LIMITS.story.min} символов. Пиши как хочется — можно в несколько абзацев.`}
          error={errors.story}
        />

        <TextField
          label="Описание фотографии"
          name="imageAlt"
          value={fields.imageAlt}
          onChange={(v) => update('imageAlt', v)}
          onBlur={() => fields.imageAlt && validateOne('imageAlt')}
          max={LIMITS.imageAlt.max}
          hint="Коротко: что изображено. Это прочитают люди, которые пользуются экранным диктором."
          placeholder="Например, белая чашка без ручки на деревянном столе"
          error={errors.imageAlt}
        />

        <TextField
          label="Как тебя подписать?"
          name="authorName"
          optional
          value={fields.authorName}
          onChange={(v) => update('authorName', v)}
          onBlur={() => validateOne('authorName')}
          max={LIMITS.authorName.max}
          hint="Можно имя, инициалы или ничего. Без подписи экспонат будет без имени."
          error={errors.authorName}
        />

        <TextField
          label="Как давно у тебя эта вещь?"
          name="keptSince"
          optional
          value={fields.keptSince}
          onChange={(v) => update('keptSince', v)}
          onBlur={() => validateOne('keptSince')}
          max={LIMITS.keptSince.max}
          placeholder="С детства, с 2012 года, около пяти лет…"
          error={errors.keptSince}
        />

        <div className="field">
          <label className="checkbox">
            <input
              type="checkbox"
              name="consent"
              checked={fields.consent}
              onChange={(e) => update('consent', e.target.checked)}
              aria-invalid={errors.consent ? true : undefined}
              aria-describedby={errors.consent ? 'consent-error' : undefined}
              aria-required="true"
            />
            <span>Я могу публиковать эту фотографию и историю и согласен(на), что они появятся в открытой коллекции.</span>
          </label>
          {errors.consent && (
            <p className="field-error" id="consent-error">
              {errors.consent}
            </p>
          )}
        </div>

        {/* Ловушка для ботов: люди это поле не видят и не заполняют */}
        <div className="honeypot" aria-hidden="true">
          <label>
            Сайт
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
          </label>
        </div>

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={photoBusy}>
            Посмотреть, как это будет выглядеть
          </button>
        </div>
      </form>
    </section>
  )
}
