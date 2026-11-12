// Проверяет собранный сайт (dist/) на случайно попавшие секреты.
// Запуск: npm run check:bundle (после npm run build).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'dist'
if (!existsSync(DIR)) {
  console.error('Папки dist нет — сначала выполни npm run build')
  process.exit(1)
}

const PATTERNS = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'секретный ключ Supabase (sb_secret_)'],
  [/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEYS/, 'имя серверной переменной'],
  [/TURNSTILE_SECRET_KEY|RATE_LIMIT_HMAC_SECRET/, 'имя серверного секрета'],
  [/0x4AAAAAA[A-Za-z0-9_-]{10,}x/, 'похоже на секрет Turnstile'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'приватный ключ'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub-токен'],
]

const files = []
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(js|css|html|json|map|txt|svg)$/.test(f)) files.push(p)
  }
}
walk(DIR)

let problems = 0
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  // JWT-ключи: расшифровываем payload и ищем роль service_role
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    const payload = Buffer.from(m[1], 'base64url').toString('utf8')
    if (/service_role/.test(payload)) {
      console.error(`✗ ${file}: JWT с ролью service_role (секретный ключ)`)
      problems++
    }
  }
  for (const [re, label] of PATTERNS) {
    if (re.test(text)) {
      console.error(`✗ ${file}: ${label}`)
      problems++
    }
  }
}
if (existsSync(join(DIR, '404.html'))) {
  console.error('✗ dist/404.html есть — Cloudflare Pages перестанет отдавать SPA-маршруты')
  problems++
}
if (problems) process.exit(1)
console.log(`✓ ${files.length} файлов проверено, секретов не найдено`)
