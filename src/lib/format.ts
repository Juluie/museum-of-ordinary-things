export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—'
  return String(n).padStart(4, '0')
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
