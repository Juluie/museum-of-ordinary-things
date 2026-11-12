# Подключение Supabase

Supabase хранит экспонаты, фото и учётную запись хранителя. Все шаги ниже меняют внешний сервис — выполняем их только после твоего подтверждения. Секреты вводишь ты сама: в панели Supabase или в своём терминале. В чат и в репозиторий их не присылаем.

Нужен бесплатный тариф (Free). Платные функции не используются.

## 1. Создать проект

1. Зайди на [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Имя: `museum-of-ordinary-things`, регион — ближайший к посетителям (например, Frankfurt).
3. Пароль базы данных сохрани в менеджере паролей. В проекте он не нужен.
4. Когда проект создан, открой **Project Settings → API Keys** и найди:
   - **Project URL** (`https://<project-ref>.supabase.co`) — публичный;
   - **Publishable key** (`sb_publishable_…`) — публичный, пойдёт в Cloudflare Pages;
   - **Secret key** (`sb_secret_…`) — секретный. Никуда копировать не нужно: функции получают его автоматически.

## 2. Связать папку проекта с Supabase

```bash
npx supabase login          # откроет браузер, вход в твой аккаунт
npx supabase link --project-ref <project-ref>
```

`<project-ref>` — часть адреса проекта до `.supabase.co`.

## 3. Миграции (таблицы, права, приватный бакет)

Сначала посмотреть, что будет применено:

```bash
npx supabase db push --dry-run
```

Затем применить:

```bash
npx supabase db push
```

Миграция `supabase/migrations/20261112000001_init.sql` создаёт:

- таблицу `exhibits` со статусами `pending / approved / rejected`;
- запрет менять текст после отправки и выдачу номера только при одобрении;
- таблицы `admins` и `submission_rate_limits`;
- включённый и принудительный RLS, у ролей `anon` и `authenticated` нет никаких прав на таблицы;
- **приватный** бакет `exhibit-images` (только JPEG, до 2 МБ) без публичных политик.

Миграции из GitHub Actions автоматически **не** применяются — только вручную этой командой.

## 4. Auth: только вход, без регистрации

Регистрация отключена в `supabase/config.toml` (`enable_signup = false`). Проверь в панели: **Authentication → Sign In / Providers**:

- **Allow new users to sign up** — выключено;
- Email provider — включён (нужен для входа по паролю);
- остальные провайдеры — выключены.

## 5. Назначить администратора

1. **Authentication → Users → Add user → Create new user**. Email — твой, пароль — длинный (от 12 символов), поставь **Auto Confirm User**.
2. **SQL Editor** → выполни, подставив свой email:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'ТВОЙ_EMAIL';
```

3. Проверка:

```sql
select u.email from public.admins a join auth.users u on u.id = a.user_id;
```

Пароль в коде и в репозитории не хранится. Снять права: `delete from public.admins where user_id = (select id from auth.users where email = '…');`

## 6. Секреты функций

Задаются в твоём терминале (значения не попадают в git) или в панели **Edge Functions → Secrets**:

```bash
npx supabase secrets set \
  SUBMISSIONS_ENABLED=false \
  TURNSTILE_SECRET_KEY=<секрет из Cloudflare Turnstile> \
  TURNSTILE_EXPECTED_HOSTNAMES=<адрес>.pages.dev \
  RATE_LIMIT_HMAC_SECRET=$(openssl rand -hex 32) \
  RATE_LIMIT_HMAC_KEY_VERSION=v1 \
  ALLOWED_ORIGINS=https://<адрес>.pages.dev
```

Полный список с пояснениями — в `.env.example`, часть 2. `SUPABASE_URL` и секретный ключ Supabase подставляет сам.

Пока `SUBMISSIONS_ENABLED=false`, форма на сервере закрыта, даже если её показать на сайте.

## 7. Деплой Edge Functions

```bash
npx supabase functions deploy submit-exhibit
npx supabase functions deploy public-exhibits
npx supabase functions deploy admin-exhibits
```

Настройка `verify_jwt = false` для этих функций берётся из `supabase/config.toml`: посетители анонимны, а права администратора функция `admin-exhibits` проверяет сама по токену и таблице `admins`.

## 8. Автоочистка записей лимитов

Записи о частоте отправок (хеши IP) должны удаляться через двое суток. Включи расширение **pg_cron** (**Database → Extensions**) и выполни в SQL Editor:

```sql
select cron.schedule(
  'cleanup-submission-rate-limits',
  '17 3 * * *',
  $$select public.cleanup_submission_rate_limits()$$
);
```

## 9. Проверка прав (обязательно перед открытием приёма)

Подставь URL и publishable key:

```bash
URL=https://<project-ref>.supabase.co
KEY=sb_publishable_...

# 1. Таблица недоступна напрямую — ожидаем ошибку прав или пустой ответ, но не данные
curl -s "$URL/rest/v1/exhibits?select=*" -H "apikey: $KEY"

# 2. Файл из бакета нельзя получить без временной ссылки — ожидаем 400/404
curl -s -o /dev/null -w '%{http_code}\n' "$URL/storage/v1/object/public/exhibit-images/pending/x.jpg"

# 3. Публичная функция отвечает
curl -s "$URL/functions/v1/public-exhibits?random=1" -H "apikey: $KEY"

# 4. Админ-функция без входа — ожидаем 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL/functions/v1/admin-exhibits" -H "apikey: $KEY" -H 'content-type: application/json' -d '{"action":"whoami"}'
```

Также войди на `/admin/login` аккаунтом, которого **нет** в `admins` — должно быть «нет прав хранителя».

## Что проверено только локально

Без Docker в среде разработки не запускался локальный Supabase. Логика функций и миграции проверены тестами (PGlite и заглушки), но на настоящем Supabase нужно отдельно проверить: заголовок IP (`cf-connecting-ip`), холодный старт модуля обработки фото (~15 МБ wasm), лимит CPU на больших фото, политики Storage. Подробнее — docs/SECURITY.md, «Известные ограничения».
