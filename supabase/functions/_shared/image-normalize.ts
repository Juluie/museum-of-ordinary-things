// Серверная нормализация фотографии через ImageMagick (WebAssembly).
// Модуль magick передаётся снаружи: в Edge Function — из `npm:@imagemagick/magick-wasm`,
// в тестах Node — из node_modules. Так один и тот же код проверяется локально.

import { INPUT_LIMITS, sniffImage, type ImageFormat } from './image-sniff.ts'

/* Минимальный набор API magick-wasm, который нам нужен. */
type MagickImage = {
  readonly width: number
  readonly height: number
  readonly hasAlpha: boolean
  quality: number
  backgroundColor: unknown
  autoOrient(): void
  strip(): void
  alpha(value: number): void
  resize(geometry: unknown): void
  write<T>(format: string, func: (data: Uint8Array) => T): T
}

export type MagickApi = {
  ImageMagick: {
    read<T>(data: Uint8Array, format: string, func: (img: MagickImage) => T): T
  }
  MagickFormat: { Jpeg: string; Png: string; WebP: string }
  MagickGeometry: new (width: number, height: number) => { greater: boolean }
  MagickColors: { White: unknown }
  AlphaAction: { Remove: number }
  ResourceLimits: { width: bigint; height: bigint; area: bigint; memory: bigint }
}

export type NormalizedImage = {
  bytes: Uint8Array
  contentType: 'image/jpeg'
  width: number
  height: number
}

export type NormalizeOptions = {
  maxPixels: number
  maxLongSide?: number
  targetBytes?: number
}

export class ImageRejectedError extends Error {
  constructor(public readonly reason: 'heic' | 'svg' | 'unsupported' | 'corrupt' | 'too_large_dimensions') {
    super(reason)
  }
}

let limitsApplied = false
function applyLimits(m: MagickApi, maxPixels: number) {
  if (limitsApplied) return
  // Защита от «декомпрессионных бомб»: ImageMagick откажется декодировать больше этого.
  m.ResourceLimits.width = 20000n
  m.ResourceLimits.height = 20000n
  m.ResourceLimits.area = BigInt(maxPixels)
  m.ResourceLimits.memory = 192n * 1024n * 1024n
  limitsApplied = true
}

const FORMAT_KEY: Record<ImageFormat, 'Jpeg' | 'Png' | 'WebP'> = {
  jpeg: 'Jpeg',
  png: 'Png',
  webp: 'WebP',
}

/**
 * Проверяет фактический формат, размеры, декодирует, поворачивает по EXIF,
 * уменьшает (никогда не увеличивает), удаляет все метаданные и кодирует в JPEG.
 */
export function normalizeImage(m: MagickApi, input: Uint8Array, opts: NormalizeOptions): NormalizedImage {
  const maxLongSide = opts.maxLongSide ?? INPUT_LIMITS.maxLongSide
  const targetBytes = opts.targetBytes ?? INPUT_LIMITS.targetBytes

  const sniff = sniffImage(input)
  if (!sniff.ok) throw new ImageRejectedError(sniff.reason)
  if (sniff.width * sniff.height > opts.maxPixels) throw new ImageRejectedError('too_large_dimensions')

  applyLimits(m, opts.maxPixels)

  try {
    // Формат указываем явно — ImageMagick не будет «угадывать» другие кодеки.
    return m.ImageMagick.read(input, m.MagickFormat[FORMAT_KEY[sniff.format]], (img) => {
      img.autoOrient()
      if (Math.max(img.width, img.height) > maxLongSide) {
        const geo = new m.MagickGeometry(maxLongSide, maxLongSide)
        geo.greater = true // только уменьшать
        img.resize(geo)
      }
      if (img.hasAlpha) {
        img.backgroundColor = m.MagickColors.White
        img.alpha(m.AlphaAction.Remove)
      }
      img.strip() // EXIF, GPS, ICC, комментарии

      let out = new Uint8Array()
      for (const q of [85, 78, 70, 62]) {
        img.quality = q
        out = img.write(m.MagickFormat.Jpeg, (d) => d.slice())
        if (out.length <= targetBytes) break
      }
      return { bytes: out, contentType: 'image/jpeg' as const, width: img.width, height: img.height }
    })
  } catch (e) {
    if (e instanceof ImageRejectedError) throw e
    throw new ImageRejectedError('corrupt')
  }
}

export const IMAGE_REJECT_MESSAGES: Record<ImageRejectedError['reason'], string> = {
  heic: 'Формат HEIC/HEIF не поддерживается. Выбери JPEG, PNG или WebP.',
  svg: 'SVG не принимается. Нужна фотография в формате JPEG, PNG или WebP.',
  unsupported: 'Формат не подходит. Нужна фотография в формате JPEG, PNG или WebP.',
  corrupt: 'Не получилось прочитать фотографию — возможно, файл повреждён.',
  too_large_dimensions: 'Фотография слишком большая по количеству пикселей. Уменьши её и попробуй снова.',
}
