// Определение настоящего формата изображения по первым байтам файла
// и чтение его размеров без полного декодирования. Без внешних зависимостей.

export type ImageFormat = 'jpeg' | 'png' | 'webp'

export type SniffResult =
  | { ok: true; format: ImageFormat; width: number; height: number }
  | { ok: false; reason: 'heic' | 'svg' | 'unsupported' | 'corrupt' }

export const INPUT_LIMITS = {
  /** Максимальный размер исходного файла, который выбирает посетитель. */
  maxFileBytes: 10 * 1024 * 1024,
  /** Максимум пикселей исходника в браузере — защита от «бомб» вида 30000×30000. */
  maxClientPixels: 60_000_000,
  /** Длинная сторона итоговой картинки. */
  maxLongSide: 1600,
  /** Желаемый вес итоговой картинки. */
  targetBytes: 1024 * 1024,
} as const

function ascii(b: Uint8Array, start: number, len: number): string {
  let s = ''
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i])
  return s
}

function u16be(b: Uint8Array, o: number) {
  return (b[o] << 8) | b[o + 1]
}
function u32be(b: Uint8Array, o: number) {
  return ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])
}
function u16le(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8)
}
function u24le(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let o = 2
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null
    const marker = b[o + 1]
    if (marker === 0xff) {
      o++
      continue
    }
    // Маркеры без длины
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2
      continue
    }
    const len = u16be(b, o + 2)
    if (len < 2) return null
    // SOF0..SOF15, кроме DHT(C4), JPG(C8), DAC(CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = u16be(b, o + 5)
      const width = u16be(b, o + 7)
      return { width, height }
    }
    o += 2 + len
  }
  return null
}

export function sniffImage(input: Uint8Array): SniffResult {
  const b = input
  if (b.length < 16) return { ok: false, reason: 'corrupt' }

  // HEIC / HEIF / AVIF: ....ftypheic / mif1 / heix ...
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4)
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand))
      return { ok: false, reason: 'heic' }
    return { ok: false, reason: 'unsupported' }
  }

  // SVG / любой текстовый XML
  const head = ascii(b, 0, Math.min(b.length, 256)).trimStart().toLowerCase()
  if (head.startsWith('<?xml') || head.startsWith('<svg') || head.includes('<svg')) {
    return { ok: false, reason: 'svg' }
  }

  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const size = jpegSize(b)
    if (!size || size.width === 0 || size.height === 0) return { ok: false, reason: 'corrupt' }
    return { ok: true, format: 'jpeg', ...size }
  }

  // PNG
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a) {
    if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return { ok: false, reason: 'corrupt' }
    const width = u32be(b, 16)
    const height = u32be(b, 20)
    if (!width || !height) return { ok: false, reason: 'corrupt' }
    return { ok: true, format: 'png', width, height }
  }

  // WebP
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4)
    if (chunk === 'VP8 ' && b.length >= 30) {
      const width = u16le(b, 26) & 0x3fff
      const height = u16le(b, 28) & 0x3fff
      if (width && height) return { ok: true, format: 'webp', width, height }
    } else if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
      const width = (bits & 0x3fff) + 1
      const height = ((bits >> 14) & 0x3fff) + 1
      return { ok: true, format: 'webp', width, height }
    } else if (chunk === 'VP8X' && b.length >= 30) {
      const width = u24le(b, 24) + 1
      const height = u24le(b, 27) + 1
      return { ok: true, format: 'webp', width, height }
    }
    return { ok: false, reason: 'corrupt' }
  }

  return { ok: false, reason: 'unsupported' }
}

export const SNIFF_MESSAGES: Record<'heic' | 'svg' | 'unsupported' | 'corrupt', string> = {
  heic: 'Формат HEIC/HEIF пока не поддерживается. Выбери, пожалуйста, JPEG, PNG или WebP — например, сделай скриншот фото или экспортируй его в JPEG.',
  svg: 'SVG не подходит. Нужна фотография в формате JPEG, PNG или WebP.',
  unsupported: 'Этот формат не подходит. Выбери фотографию в формате JPEG, PNG или WebP.',
  corrupt: 'Не получилось прочитать файл — возможно, он повреждён. Попробуй другую фотографию.',
}
