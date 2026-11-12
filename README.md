# Музей обычных вещей

Маленький онлайн-музей предметов, которые люди хранят без особой причины. Посетитель открывает случайный экспонат — фото и короткую историю, — листает дальше и может принести свою вещь. Новые вещи появляются на сайте только после ручной проверки.

- Сайт: `<ЗАПОЛНИТЬ после первой публикации: https://….pages.dev>`
- Репозиторий: [github.com/Juluie/museum-of-ordinary-things](https://github.com/Juluie/museum-of-ordinary-things) (приватный)

**Стек:** React 19, TypeScript, Vite, React Router, обычный CSS · Supabase (Postgres, приватный Storage, Auth, Edge Functions) · Cloudflare Pages · Cloudflare Turnstile.

## Установка

Нужен Node 22 (см. `.nvmrc`; минимум 20.19).

```bash
npm ci
```

## Demo-режим

```bash
npm run dev
```

Откроется `http://localhost:5173`. По умолчанию сайт работает в demo: шесть вымышленных экспонатов, вверху полоса «Демо-версия», отправка показывает предпросмотр, но ничего никуда не отправляет. `/admin` — незащищённый макет админки с вымышленными данными.

## Подключение настоящего backend

1. Supabase — по шагам в [docs/SETUP_SUPABASE.md](docs/SETUP_SUPABASE.md) (миграции, приватный бакет, администратор, секреты, функции).
2. Создай `.env.local` по образцу `.env.example` (часть 1) — только публичные значения:

```
VITE_APP_MODE=live
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
VITE_TURNSTILE_SITE_KEY=…
VITE_SUBMISSIONS_ENABLED=false
```

Если live настроен не полностью, сайт покажет «Музей временно недоступен», а не переключится тихо в demo.

## Тесты

```bash
npm run lint             # oxlint
npm run typecheck        # TypeScript
npm test                 # unit: форма, фото, миграции (PGlite), серверная логика, удаление EXIF
npm run test:e2e         # Playwright на demo-сборке, десктоп и телефон
npm run typecheck:functions   # deno check Edge Functions (нужен Deno)
npm run check            # всё, кроме e2e, + проверка сборки на секреты
```

## Сборка

```bash
npm run build            # → dist/
npm run check:bundle     # в dist нет секретных ключей и 404.html
npm run preview          # посмотреть сборку локально
```

## Публикация

Сайт публикует Cloudflare Pages из ветки `main` (build `npm run build`, output `dist`). База и функции Supabase обновляются вручную. Подробно — [docs/DEPLOY.md](docs/DEPLOY.md). Работа с Git и GitHub простыми словами — [docs/GITHUB.md](docs/GITHUB.md).

## Модерация

`/admin/login` → вход хранителя. Вкладки «На проверке», «Опубликовано», «Отклонено». Одобрить — вещь получает номер и появляется на сайте; отклонить — фото сразу удаляется. Администратора назначают вручную SQL-запросом (пароль в коде не хранится) — [docs/SETUP_SUPABASE.md §5](docs/SETUP_SUPABASE.md#5-назначить-администратора).

## Отключить отправку

```bash
npx supabase secrets set SUBMISSIONS_ENABLED=false
```

Действует сразу. Чтобы скрыть форму на сайте — `VITE_SUBMISSIONS_ENABLED=false` в Cloudflare Pages и пересборка.

## Удалить экспонат

Админка → нужная вкладка → **Удалить навсегда** → подтвердить. Удаляются запись и фото. Порядок работы с просьбами об удалении — [docs/OPERATIONS.md](docs/OPERATIONS.md#удаление-по-обращению).

## Документация

| Файл | О чём |
|---|---|
| [PLAN.md](PLAN.md) | этапы, статус, решения по умолчанию |
| [docs/SETUP_SUPABASE.md](docs/SETUP_SUPABASE.md) | подключение Supabase |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Cloudflare Pages, переменные, откат |
| [docs/GITHUB.md](docs/GITHUB.md) | репозиторий, commit, push, откат |
| [docs/SECURITY.md](docs/SECURITY.md) | модель доступа, приватность, ограничения |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | модерация, сроки, очистка, бэкапы |
| [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md) | перед открытием приёма |

## Структура

```
src/            сайт: pages/, components/, lib/ (api, config, фото), styles/, demo/
supabase/
  migrations/   схема базы, права, бакет
  functions/    submit-exhibit, public-exhibits, admin-exhibits, _shared/
tests/          unit-тесты базы и серверной логики
e2e/            тесты в браузере
docs/           инструкции
```
