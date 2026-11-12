import { useId } from 'react'
import { charLength } from '../../supabase/functions/_shared/validation.ts'

type Props = {
  label: string
  name: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  max: number
  optional?: boolean
  multiline?: boolean
  placeholder?: string
  hint?: string
  error?: string
  autoComplete?: string
}

export function TextField({ label, name, value, onChange, onBlur, max, optional, multiline, placeholder, hint, error, autoComplete = 'off' }: Props) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const counterId = `${id}-counter`
  const len = charLength(value.trim())
  const describedBy = [hint ? hintId : null, counterId, error ? errorId : null].filter(Boolean).join(' ')
  const common = {
    id,
    name,
    value,
    placeholder,
    autoComplete,
    onBlur,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    'aria-required': optional ? undefined : true,
  } as const

  return (
    <div className="field">
      <div className="field-row">
        <label htmlFor={id} className="field-label">
          {label} {optional && <span className="field-optional">— необязательно</span>}
        </label>
        <span id={counterId} className="field-counter" data-over={len > max} aria-live="off">
          <span className="visually-hidden">Символов: </span>
          {len} / {max}
        </span>
      </div>
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {multiline ? (
        <textarea {...common} className="textarea" rows={8} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} className="input" type="text" onChange={(e) => onChange(e.target.value)} />
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  )
}
