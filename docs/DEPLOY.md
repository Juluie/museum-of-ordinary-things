# Публикация

Сайт и сервер публикуются **отдельно**:

| Что | Где | Как обновляется |
|---|---|---|
| Сайт (React, `dist/`) | Cloudflare Pages | автоматически после `git push` в `main` |
| База, фото, функции | Supabase | вручную командами из docs/SETUP_SUPABASE.md |

GitHub Actions только проверяет код (`.github/workflows/ci.yml`) и ничего не публикует. Отдельного workflow для деплоя нет.

## 1. Репозиторий

Код хранится в приватном репозитории GitHub `<owner>/museum-of-ordinary-things` (ссылка появится в README после создания). Как с ним работать — docs/GITHUB.md.

## 2. Cloudflare Pages (Git-интеграция)

> После подключения **каждый push в `main` автоматически публикует сайт**. Push в другие ветки создаёт preview-версию по отдельному адресу.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Pages → Connect to Git**.
2. Разреши приложению Cloudflare доступ **только** к репозиторию `museum-of-ordinary-things`.
3. Настройки сборки:

| Поле | Значение |
|---|---|
| Production branch | `main` |
| Framework preset | None (или Vite) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | пусто (корень) |

Версия Node берётся из `.nvmrc` (22).

## 3. SPA-маршруты

Адреса `/submit`, `/exhibit/<id>`, `/about`, `/privacy`, `/admin` — это маршруты React. Cloudflare Pages отдаёт `index.html` на любой неизвестный путь, **если в сборке нет файла `404.html`**. Мы его не создаём, а `npm run check:bundle` падает, если он появится. Файл `_redirects` не нужен.

## 4. Переменные окружения

**Settings → Variables and Secrets.** Задаются отдельно для Production и Preview.

### Первая публикация — demo

| Переменная | Production | Preview |
|---|---|---|
| `VITE_APP_MODE` | `demo` | `demo` |

Больше ничего не нужно: сайт показывает вымышленные экспонаты с пометкой «Демо-версия», отправка ничего не сохраняет.

### Подключение настоящего музея

| Переменная | Production | Preview |
|---|---|---|
| `VITE_APP_MODE` | `live` | `demo` |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | — |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | — |
| `VITE_TURNSTILE_SITE_KEY` | site key | — |
| `VITE_SUBMISSIONS_ENABLED` | `false`, потом `true` | — |

Preview остаются в demo, чтобы ветки с экспериментами не работали с боевой базой.

Все `VITE_*` попадают в браузер — секретов среди них быть не должно. Сайт откажется запускаться, если в `VITE_SUPABASE_PUBLISHABLE_KEY` вставить секретный ключ.

После изменения переменных нужна новая сборка: **Deployments → … → Retry deployment** или новый push.

## 5. Allowed origins

В секретах Supabase `ALLOWED_ORIGINS` — список адресов сайта через запятую, без `/` в конце:

```
ALLOWED_ORIGINS=https://museum-of-ordinary-things.pages.dev,https://<свой-домен>
```

Запросы к функциям с других адресов браузер не пропустит.

## 6. Turnstile

1. Cloudflare → **Turnstile → Add widget**. Домены — адрес Pages и свой домен. Режим — Managed.
2. **Site key** → `VITE_TURNSTILE_SITE_KEY` в Cloudflare Pages.
3. **Secret key** → `npx supabase secrets set TURNSTILE_SECRET_KEY=…` (только в Supabase).
4. `TURNSTILE_EXPECTED_HOSTNAMES` в Supabase — те же домены без `https://`.

## 7. Проверка production

После каждой публикации:

1. **Deployments** в Cloudflare — статус Success, коммит совпадает с последним в `main`.
2. Открой `/`, `/exhibit`, обнови страницу на `/exhibit/<id>`, `/submit`, `/about`, `/privacy`, `/admin` — ни один не 404.
3. В demo видна полоса «Демо-версия».
4. Телефон: нет горизонтальной прокрутки.
5. Для live — полный список в docs/LAUNCH_CHECKLIST.md.

## 8. Откат

- **Сайт:** Cloudflare → проект → **Deployments** → выбрать прошлую успешную публикацию → **Rollback to this deployment**. Код в GitHub при этом не меняется; исправление потом отправить обычным коммитом (или `git revert`, см. docs/GITHUB.md).
- **Срочно закрыть приём:** `npx supabase secrets set SUBMISSIONS_ENABLED=false` — действует сразу, без пересборки сайта.
- **Функции:** выполнить `git checkout <старый-коммит> -- supabase/functions` и задеплоить функции заново, затем вернуть файлы.
- **База:** миграции не откатываются автоматически. Для отката пишется новая миграция; перед любой миграцией — резервная копия (docs/OPERATIONS.md).
