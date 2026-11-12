export type ShareResult = 'shared' | 'copied' | 'cancelled' | { failed: string }

/** Web Share API, если есть; иначе копирование ссылки в буфер. */
export async function shareLink(url: string, title: string, nav: Navigator = navigator): Promise<ShareResult> {
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title, url })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // Например, NotAllowedError — пробуем скопировать.
    }
  }
  if (nav.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(url)
      return 'copied'
    } catch {
      /* ниже */
    }
  }
  return { failed: url }
}
