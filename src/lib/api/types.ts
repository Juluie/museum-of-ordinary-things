import type { SubmissionFields, FieldName } from '../../../supabase/functions/_shared/validation.ts'
import type { AdminExhibit, Exhibit, ExhibitStatus } from '../../types/exhibit.ts'

export type RandomResult = { exhibit: Exhibit | null; hasOthers: boolean }

export type SubmitPayload = {
  fields: SubmissionFields
  photo: Blob
  submissionId: string
  turnstileToken: string | null
  honeypot: string
}

export type SubmitOutcome =
  | { kind: 'accepted' }
  | { kind: 'demo' }
  | {
      kind: 'error'
      code: string
      message: string
      fields?: Partial<Record<FieldName | 'photo', string>>
      retryable: boolean
    }

export interface MuseumApi {
  readonly mode: 'demo' | 'live'
  getRandom(excludeId?: string): Promise<RandomResult>
  /** null — экспонат не найден (или не опубликован: ответ одинаковый). */
  getById(id: string): Promise<Exhibit | null>
  submit(payload: SubmitPayload): Promise<SubmitOutcome>
}

export type AdminList = { items: AdminExhibit[]; total: number; page: number; pageSize: number }
export type AdminAction = 'approve' | 'reject' | 'unpublish' | 'delete'

export interface AdminApi {
  readonly mode: 'demo' | 'live'
  /** Бросает ApiError('forbidden'), если пользователь не администратор. */
  whoami(): Promise<void>
  list(status: ExhibitStatus, page: number): Promise<AdminList>
  act(action: AdminAction, id: string): Promise<void>
}

/** Ошибка чтения: сеть или сервер. «Не найдено» — это не ошибка, а null. */
export type ApiErrorKind = 'network' | 'server' | 'unauthorized' | 'forbidden' | 'conflict'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  constructor(kind: ApiErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}
