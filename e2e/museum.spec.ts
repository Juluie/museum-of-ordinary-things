import { expect, test, type Page } from '@playwright/test'

const FIRST = '/exhibit/d0000000-0000-4000-8000-000000000001'

async function noHorizontalScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(sw).toBeLessThanOrEqual(cw)
}

test('главная → случайный экспонат → следующий', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Демо-версия.')).toBeVisible()
  await page.getByRole('link', { name: 'Посмотреть экспонат' }).click()
  await expect(page).toHaveURL(/\/exhibit\/[0-9a-f-]{36}$/)
  const first = page.url()
  await page.getByRole('button', { name: 'Следующая вещь' }).click()
  await expect(page).not.toHaveURL(first)
  await expect(page.getByText(/Экспонат № \d{4}/)).toBeVisible()
})

for (const path of [FIRST, '/submit', '/about', '/privacy', '/admin', '/admin/login']) {
  test(`прямой заход и перезагрузка ${path}`, async ({ page }) => {
    const res = await page.goto(path)
    expect(res?.status()).toBeLessThan(400)
    await page.reload()
    await expect(page.locator('main h1').first()).toBeVisible()
    await noHorizontalScroll(page)
  })
}

test('несуществующий экспонат и адрес', async ({ page }) => {
  await page.goto('/exhibit/00000000-0000-4000-8000-000000000999')
  await expect(page.getByRole('heading', { name: 'Экспонат не найден' })).toBeVisible()
  await page.goto('/no-such-page')
  await expect(page.locator('main h1')).toBeVisible()
})

test('главная без горизонтального скролла', async ({ page }) => {
  await page.goto('/')
  await noHorizontalScroll(page)
  await page.goto(FIRST)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await noHorizontalScroll(page)
})

test('клавиатура: Tab доходит до основных кнопок, фокус виден', async ({ page, isMobile }) => {
  test.skip(isMobile, 'только для клавиатуры')
  await page.goto('/')
  let found = false
  for (let i = 0; i < 12 && !found; i++) {
    await page.keyboard.press('Tab')
    found = (await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'Посмотреть экспонат'
  }
  expect(found).toBe(true)
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)
  expect(outline).not.toBe('none')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/exhibit\//)
})

test('форма: реальное фото → предпросмотр → тестовая отправка', async ({ page }) => {
  await page.goto('/submit')
  // Маленький PNG, нарисованный прямо в браузере
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 300
    c.height = 200
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#c33'
    ctx.fillRect(0, 0, 300, 200)
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'thing.png', mimeType: 'image/png', buffer: Buffer.from(png) })
  await expect(page.getByText('Фото готово: 300 × 200 px')).toBeVisible()
  await page.getByLabel('Название').fill('Пуговица')
  await page.getByLabel('Почему ты хранишь эту вещь?').fill('Оторвалась от пальто, которое я давно отдала, а пуговица осталась.')
  await page.getByLabel('Описание фотографии').fill('Красная квадратная заглушка')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Посмотреть, как это будет выглядеть' }).click()
  await expect(page.getByRole('heading', { name: 'Так экспонат будет выглядеть в музее' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Пуговица' })).toBeVisible()
  await noHorizontalScroll(page)
  await page.getByRole('button', { name: 'Отправить (тест)' }).click()
  await expect(page.getByRole('heading', { name: 'Это была тестовая отправка' })).toBeVisible()
})

test('форма: неподдерживаемый файл', async ({ page }) => {
  await page.goto('/submit')
  await page.locator('input[type=file]').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('GIF89a' + 'x'.repeat(100)) })
  await expect(page.locator('.field-error')).toBeVisible()
})

test('демо-админка помечена как незащищённый макет', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByText('Незащищённый макет.')).toBeVisible()
  await page.getByRole('button', { name: 'Одобрить' }).first().click()
  await expect(page.getByText(/— опубликован\./)).toBeVisible()
})
