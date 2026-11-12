// Серверная обработка фото на настоящем ImageMagick (тот же wasm, что и в Edge Function).
import {
  AlphaAction,
  ImageMagick,
  initializeImageMagick,
  MagickColors,
  MagickFormat,
  MagickGeometry,
  ResourceLimits,
} from '@imagemagick/magick-wasm'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import { normalizeImage, ImageRejectedError, type MagickApi } from '../../supabase/functions/_shared/image-normalize.ts'
import { sniffImage } from '../../supabase/functions/_shared/image-sniff.ts'

const m = { ImageMagick, MagickFormat, MagickGeometry, MagickColors, AlphaAction, ResourceLimits } as unknown as MagickApi

beforeAll(async () => {
  const require = createRequire(import.meta.url)
  const wasm = readFileSync(require.resolve('@imagemagick/magick-wasm/magick.wasm'))
  await initializeImageMagick(wasm)
})

function make(format: 'Jpeg' | 'Png' | 'WebP', w: number, h: number, transparent = false): Uint8Array {
  const color = transparent ? MagickColors.Transparent : MagickColors.SteelBlue
  return ImageMagick.read(color, w, h, (img) => img.write(MagickFormat[format], (d) => d.slice()))
}

/** Вставляет в JPEG сегмент EXIF с Orientation=6 и GPS-тегами. */
function withExif(jpeg: Uint8Array): Uint8Array {
  const tiff = new Uint8Array(68)
  const v = new DataView(tiff.buffer)
  tiff.set([0x49, 0x49, 0x2a, 0x00])
  v.setUint32(4, 8, true)
  // IFD0
  v.setUint16(8, 2, true)
  v.setUint16(10, 0x0112, true) // Orientation
  v.setUint16(12, 3, true)
  v.setUint32(14, 1, true)
  v.setUint16(18, 6, true)
  v.setUint16(22, 0x8825, true) // GPS IFD pointer
  v.setUint16(24, 4, true)
  v.setUint32(26, 1, true)
  v.setUint32(30, 38, true)
  v.setUint32(34, 0, true)
  // GPS IFD
  v.setUint16(38, 2, true)
  v.setUint16(40, 0x0000, true) // GPSVersionID
  v.setUint16(42, 1, true)
  v.setUint32(44, 4, true)
  tiff.set([2, 3, 0, 0], 48)
  v.setUint16(52, 0x0001, true) // GPSLatitudeRef
  v.setUint16(54, 2, true)
  v.setUint32(56, 2, true)
  tiff.set([0x4e, 0], 60)
  v.setUint32(64, 0, true)

  const header = new TextEncoder().encode('Exif\0\0')
  const len = 2 + header.length + tiff.length
  const app1 = new Uint8Array(4 + header.length + tiff.length)
  app1.set([0xff, 0xe1, len >> 8, len & 0xff])
  app1.set(header, 4)
  app1.set(tiff, 4 + header.length)

  const out = new Uint8Array(jpeg.length + app1.length)
  out.set(jpeg.subarray(0, 2))
  out.set(app1, 2)
  out.set(jpeg.subarray(2), 2 + app1.length)
  return out
}

const contains = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, 'latin1'))
const opts = { maxPixels: 12_000_000 }

describe('распознавание формата', () => {
  it('JPEG / PNG / WebP и их размеры', () => {
    expect(sniffImage(make('Jpeg', 320, 200))).toMatchObject({ ok: true, format: 'jpeg', width: 320, height: 200 })
    expect(sniffImage(make('Png', 50, 70))).toMatchObject({ ok: true, format: 'png', width: 50, height: 70 })
    expect(sniffImage(make('WebP', 64, 32))).toMatchObject({ ok: true, format: 'webp', width: 64, height: 32 })
  })
  it('SVG, HEIC, текст и мусор отклоняются', () => {
    const enc = (s: string) => new TextEncoder().encode(s)
    expect(sniffImage(enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toEqual({ ok: false, reason: 'svg' })
    expect(sniffImage(enc('<?xml version="1.0"?><svg></svg>      '))).toEqual({ ok: false, reason: 'svg' })
    const heic = new Uint8Array(32)
    heic.set(enc('ftypheic'), 4)
    expect(sniffImage(heic)).toEqual({ ok: false, reason: 'heic' })
    expect(sniffImage(enc('GIF89a...............'))).toEqual({ ok: false, reason: 'unsupported' })
    expect(sniffImage(new Uint8Array(4))).toEqual({ ok: false, reason: 'corrupt' })
  })
  it('расширение не важно — важно содержимое', () => {
    // PNG, переименованный в .jpg, распознаётся как PNG
    expect(sniffImage(make('Png', 10, 10))).toMatchObject({ format: 'png' })
  })
})

describe('нормализация', () => {
  it('удаляет EXIF и GPS, применяет ориентацию', () => {
    const src = withExif(make('Jpeg', 400, 200))
    expect(contains(src, 'Exif')).toBe(true)
    const out = normalizeImage(m, src, opts)
    expect(contains(out.bytes, 'Exif')).toBe(false)
    // Orientation=6 → поворот на 90°: 400×200 становится 200×400
    expect([out.width, out.height]).toEqual([200, 400])
    expect(sniffImage(out.bytes)).toMatchObject({ ok: true, format: 'jpeg', width: 200, height: 400 })
  })
  it('уменьшает длинную сторону до 1600 и сохраняет пропорции', () => {
    const out = normalizeImage(m, make('Png', 3200, 1000), opts)
    expect(out.width).toBe(1600)
    expect(out.height).toBe(500)
    expect(out.contentType).toBe('image/jpeg')
  })
  it('не увеличивает маленькие', () => {
    const out = normalizeImage(m, make('WebP', 300, 500), opts)
    expect([out.width, out.height]).toEqual([300, 500])
  })
  it('прозрачный PNG получает белый фон', () => {
    const out = normalizeImage(m, make('Png', 40, 40, true), opts)
    expect(out.bytes.length).toBeGreaterThan(0)
  })
  it('повреждённый файл отклоняется', () => {
    const jpeg = make('Jpeg', 200, 200)
    const broken = jpeg.slice(0, 200)
    expect(() => normalizeImage(m, broken, opts)).toThrow(ImageRejectedError)
  })
  it('«бомба» по пикселям отклоняется до декодирования', () => {
    const png = make('Png', 10, 10)
    const v = new DataView(png.buffer, png.byteOffset)
    v.setUint32(16, 30000)
    v.setUint32(20, 30000)
    try {
      normalizeImage(m, png, opts)
      expect.unreachable()
    } catch (e) {
      expect((e as ImageRejectedError).reason).toBe('too_large_dimensions')
    }
  })
  it('SVG отклоняется', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')
    expect(() => normalizeImage(m, svg, opts)).toThrow(ImageRejectedError)
  })
})
