// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AppContext } from '../lib/app-context.ts'
import type { AppConfig } from '../lib/config.ts'
import { readAppConfig } from '../lib/config.ts'
import { createDemoApi, createDemoAdminApi } from '../lib/api/demo.ts'
import type { MuseumApi, SubmitOutcome, SubmitPayload } from '../lib/api/types.ts'
import { checkPhotoFile, PhotoError, type PreparedPhoto } from '../lib/image-prep.ts'
import { shareLink } from '../lib/share.ts'
import { ExhibitPage } from '../pages/ExhibitPage.tsx'
import { RandomExhibitPage } from '../pages/RandomExhibitPage.tsx'
import { SubmitPage } from '../pages/SubmitPage.tsx'
import { DEMO_EXHIBITS } from '../demo/exhibits.ts'
import type { Exhibit } from '../types/exhibit.ts'

beforeAll(() => {
  // jsdom не умеет object URL — подменяем.
  URL.createObjectURL = () => 'blob:test'
  URL.revokeObjectURL = () => {}
})
afterEach(cleanup)

const DEMO: AppConfig = { mode: 'demo' }
const LIVE: AppConfig = {
  mode: 'live',
  supabaseUrl: 'https://abc.supabase.co',
  publishableKey: 'sb_publishable_x',
  turnstileSiteKey: null,
  submissionsEnabled: true,
}

function renderAt(path: string, api: MuseumApi, config: AppConfig = DEMO, element?: React.ReactNode) {
  return render(
    <AppContext.Provider value={{ api, config }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/exhibit" element={<RandomExhibitPage />} />
          <Route path="/exhibit/:id" element={<ExhibitPage />} />
          <Route path="/submit" element={element ?? <SubmitPage />} />
          <Route path="/submitted" element={<h1>Отправлено</h1>} />
        </Routes>
      </MemoryRouter>
    </AppContext.Provider>,
  )
}

// ---------- Форма ----------

const fakePhoto: PreparedPhoto = { blob: new Blob(['x'], { type: 'image/jpeg' }), width: 800, height: 600, originalName: 'a.jpg' }
const okPrepare = async () => fakePhoto

function apiWith(submit: (p: SubmitPayload) => Promise<SubmitOutcome>): MuseumApi {
  return { ...createDemoApi([], 0), mode: 'live', submit: vi.fn(submit) }
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
  await user.upload(document.querySelector<HTMLInputElement>('input[type=file]')!, file)
  await screen.findByText(/Фото готово/)
  await user.type(screen.getByLabelText('Название'), 'Старая чашка')
  await user.type(screen.getByLabelText('Почему ты хранишь эту вещь?'), 'Потому что её подарила бабушка давно.')
  await user.type(screen.getByLabelText('Описание фотографии'), 'Белая чашка на столе')
  await user.click(screen.getByRole('checkbox'))
}

describe('Форма отправки', () => {
  it('показывает ошибки обязательных полей и требует согласие', async () => {
    const user = userEvent.setup()
    renderAt('/submit', createDemoApi([], 0), DEMO, <SubmitPage prepare={okPrepare} />)
    await user.click(screen.getByRole('button', { name: /Посмотреть, как это будет выглядеть/ }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Добавь фотографию')
    expect(alert).toHaveTextContent(/соглас/i)
    expect(screen.getByLabelText('Название')).toHaveAttribute('aria-invalid', 'true')
  })

  it('не пропускает слишком длинное название и короткую историю', async () => {
    const user = userEvent.setup()
    renderAt('/submit', createDemoApi([], 0), DEMO, <SubmitPage prepare={okPrepare} />)
    await fillValid(user)
    const title = screen.getByLabelText('Название')
    await user.clear(title)
    await user.click(title)
    await user.paste('я'.repeat(81))
    const story = screen.getByLabelText('Почему ты хранишь эту вещь?')
    await user.clear(story)
    await user.type(story, 'коротко')
    await user.click(screen.getByRole('button', { name: /Посмотреть, как это будет выглядеть/ }))
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(story).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('81 / 80')).toBeInTheDocument()
  })

  it('показывает понятную ошибку фото', async () => {
    const user = userEvent.setup()
    const prepare = async () => {
      throw new PhotoError('Этот формат не поддерживается.')
    }
    renderAt('/submit', createDemoApi([], 0), DEMO, <SubmitPage prepare={prepare} />)
    await user.upload(document.querySelector<HTMLInputElement>('input[type=file]')!, new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByText('Этот формат не поддерживается.')).toBeInTheDocument()
  })

  it('demo: предпросмотр → тестовая отправка', async () => {
    const user = userEvent.setup()
    renderAt('/submit', createDemoApi([], 0), DEMO, <SubmitPage prepare={okPrepare} />)
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: /Посмотреть, как это будет выглядеть/ }))
    expect(await screen.findByText('Так экспонат будет выглядеть в музее')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Старая чашка' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Отправить (тест)' }))
    expect(await screen.findByRole('heading', { name: 'Отправлено' })).toBeInTheDocument()
  })

  it('ошибка сети не стирает текст, повтор использует тот же submissionId', async () => {
    const user = userEvent.setup()
    const api = apiWith(async () => ({ kind: 'error', code: 'network', message: 'Нет связи. Текст сохранён.', retryable: true }))
    renderAt('/submit', api, LIVE, <SubmitPage prepare={okPrepare} newId={() => crypto.randomUUID()} />)
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: /Посмотреть, как это будет выглядеть/ }))
    await user.click(await screen.findByRole('button', { name: 'Отправить в музей' }))
    expect(await screen.findByText('Нет связи. Текст сохранён.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Попробовать ещё раз' }))
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(2))
    const calls = vi.mocked(api.submit).mock.calls
    expect(calls[0][0].submissionId).toBe(calls[1][0].submissionId)
    await user.click(screen.getByRole('button', { name: 'Вернуться к редактированию' }))
    expect(screen.getByLabelText('Название')).toHaveValue('Старая чашка')
  })

  it('двойной клик отправляет только один раз', async () => {
    const user = userEvent.setup()
    let release: (v: SubmitOutcome) => void = () => {}
    const api = apiWith(() => new Promise((r) => (release = r)))
    renderAt('/submit', api, LIVE, <SubmitPage prepare={okPrepare} />)
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: /Посмотреть, как это будет выглядеть/ }))
    const send = await screen.findByRole('button', { name: 'Отправить в музей' })
    await user.click(send)
    await user.click(send)
    expect(screen.getByRole('button', { name: 'Отправляем…' })).toBeDisabled()
    release({ kind: 'accepted' })
    await screen.findByRole('heading', { name: 'Отправлено' })
    expect(api.submit).toHaveBeenCalledTimes(1)
  })

  it('приём закрыт — формы нет', () => {
    renderAt('/submit', createDemoApi([], 0), { ...LIVE, submissionsEnabled: false })
    expect(screen.getByText('Приём новых вещей временно закрыт')).toBeInTheDocument()
    expect(screen.queryByLabelText('Название')).not.toBeInTheDocument()
  })
})

// ---------- Проверка файла ----------

describe('Проверка файла фото', () => {
  const file = (bytes: number[], name = 'x', size?: number) => {
    const data = new Uint8Array(size ?? Math.max(bytes.length, 64))
    data.set(bytes)
    return new File([data], name)
  }

  it('отклоняет неподдерживаемый формат (GIF)', async () => {
    await expect(checkPhotoFile(file([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).rejects.toThrow(PhotoError)
  })
  it('отклоняет HEIC с понятным сообщением', async () => {
    const heic = [0, 0, 0, 0x18, ...'ftypheic'.split('').map((c) => c.charCodeAt(0))]
    await expect(checkPhotoFile(file(heic, 'a.heic'))).rejects.toThrow(/HEIC/i)
  })
  it('отклоняет файл больше 10 МБ', async () => {
    await expect(checkPhotoFile(file([0xff, 0xd8, 0xff], 'big.jpg', 10 * 1024 * 1024 + 1))).rejects.toThrow(/10 МБ/)
  })
  it('отклоняет пустой файл', async () => {
    await expect(checkPhotoFile(new File([], 'e.jpg'))).rejects.toThrow(/пустой/)
  })
})

// ---------- Поделиться ----------

describe('Поделиться', () => {
  it('использует Web Share, если есть', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    expect(await shareLink('u', 't', { share } as unknown as Navigator)).toBe('shared')
  })
  it('без Web Share копирует ссылку', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await shareLink('u', 't', { clipboard: { writeText } } as unknown as Navigator)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('u')
  })
  it('если ничего нет — возвращает ссылку для ручного копирования', async () => {
    expect(await shareLink('u', 't', {} as Navigator)).toEqual({ failed: 'u' })
  })
  it('отмена шаринга — не ошибка', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('x', 'AbortError'))
    expect(await shareLink('u', 't', { share } as unknown as Navigator)).toBe('cancelled')
  })
})

// ---------- Экспонаты ----------

describe('Экспонаты', () => {
  it('несуществующий id → «Экспонат не найден»', async () => {
    renderAt('/exhibit/00000000-0000-4000-8000-000000000999', createDemoApi(DEMO_EXHIBITS, 0))
    expect(await screen.findByRole('heading', { name: 'Экспонат не найден' })).toBeInTheDocument()
  })

  it('пустая коллекция', async () => {
    renderAt('/exhibit', createDemoApi([], 0))
    expect(await screen.findByText('В музее ещё нет ни одной вещи')).toBeInTheDocument()
  })

  it('один экспонат: «Следующая вещь» сообщает, что он единственный', async () => {
    const user = userEvent.setup()
    const one = [DEMO_EXHIBITS[0]]
    renderAt(`/exhibit/${one[0].id}`, createDemoApi(one, 0))
    await screen.findByRole('heading', { name: one[0].title })
    await user.click(screen.getByRole('button', { name: 'Следующая вещь' }))
    expect(await screen.findByText(/только эта вещь/)).toBeInTheDocument()
  })

  it('HTML в истории показывается как текст и не выполняется', async () => {
    const evil: Exhibit = {
      ...DEMO_EXHIBITS[0],
      title: '<b>жирный</b>',
      story: '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script> обычный текст',
    }
    renderAt(`/exhibit/${evil.id}`, createDemoApi([evil], 0))
    expect(await screen.findByText(/<img src=x onerror=/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '<b>жирный</b>' })).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('img[src="x"]')).toBeNull()
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
  })

  it('ошибка сети → кнопка повтора', async () => {
    const api: MuseumApi = {
      ...createDemoApi([], 0),
      getById: vi.fn().mockRejectedValueOnce(new Error('Нет связи')).mockResolvedValue(DEMO_EXHIBITS[0]),
    }
    const user = userEvent.setup()
    renderAt(`/exhibit/${DEMO_EXHIBITS[0].id}`, api)
    await user.click(await screen.findByRole('button', { name: 'Попробовать ещё раз' }))
    expect(await screen.findByRole('heading', { name: DEMO_EXHIBITS[0].title })).toBeInTheDocument()
  })
})

// ---------- Конфигурация ----------

describe('Конфигурация', () => {
  const base = { VITE_APP_MODE: 'live', VITE_SUPABASE_URL: 'https://abc.supabase.co' } as unknown as ImportMetaEnv
  it('по умолчанию — demo', () => {
    expect(readAppConfig({} as ImportMetaEnv)).toEqual({ ok: true, config: { mode: 'demo' } })
  })
  it('отклоняет секретный ключ в браузере', () => {
    const r = readAppConfig({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' })
    expect(r.ok).toBe(false)
  })
  it('отклоняет JWT с ролью service_role', () => {
    const payload = btoa(JSON.stringify({ role: 'service_role' }))
    const r = readAppConfig({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: `h.${payload}.s` })
    expect(r.ok).toBe(false)
  })
  it('live без ключа — ошибка, а не тихий demo', () => {
    const r = readAppConfig(base)
    expect(r).toMatchObject({ ok: false })
  })
  it('приём включён без Turnstile — ошибка', () => {
    const r = readAppConfig({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', VITE_SUBMISSIONS_ENABLED: 'true' })
    expect(r).toMatchObject({ ok: false, problems: ['VITE_TURNSTILE_SITE_KEY'] })
  })
})

// ---------- Демо-админка ----------

describe('Демо-админка', () => {
  it('одобрение присваивает номер, номер сохраняется после снятия', async () => {
    const api = createDemoAdminApi()
    const pending = (await api.list('pending', 1)).items[0]
    expect(pending.number).toBeNull()
    await api.act('approve', pending.id)
    const approved = (await api.list('approved', 1)).items.find((i) => i.id === pending.id)!
    expect(approved.number).toBeGreaterThan(0)
    await api.act('unpublish', pending.id)
    const back = (await api.list('pending', 1)).items.find((i) => i.id === pending.id)!
    expect(back.number).toBe(approved.number)
  })
})
