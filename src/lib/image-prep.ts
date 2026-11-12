// Подготовка фото в браузере: проверка, поворот по EXIF, уменьшение, JPEG без метаданных.
// Это удобство для посетителя (меньше трафика), а не защита — сервер проверяет всё заново.
import { INPUT_LIMITS, SNIFF_MESSAGES, sniffImage } from '../../supabase/functions/_shared/image-sniff.ts'

export type PreparedPhoto = {
  blob: Blob
  width: number
  height: number
  originalName: string
}

export class PhotoError extends Error {}

export async function checkPhotoFile(file: File): Promise<{ width: number; height: number }> {
  if (file.size === 0) throw new PhotoError('Файл пустой. Выбери другую фотографию.')
  if (file.size > INPUT_LIMITS.maxFileBytes)
    throw new PhotoError('Файл больше 10 МБ. Выбери фото поменьше или уменьши его.')
  const head = new Uint8Array(await file.arrayBuffer())
  const sniff = sniffImage(head)
  if (!sniff.ok) throw new PhotoError(SNIFF_MESSAGES[sniff.reason])
  if (sniff.width * sniff.height > INPUT_LIMITS.maxClientPixels)
    throw new PhotoError('У фотографии слишком большое разрешение. Уменьши её и попробуй снова.')
  return { width: sniff.width, height: sniff.height }
}

function fit(w: number, h: number, max: number) {
  const scale = Math.min(1, max / Math.max(w, h)) // никогда не увеличиваем
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  await checkPhotoFile(file)

  let bitmap: ImageBitmap
  try {
    // from-image — учитываем ориентацию из EXIF
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new PhotoError(SNIFF_MESSAGES.corrupt)
  }

  const { width, height } = fit(bitmap.width, bitmap.height, INPUT_LIMITS.maxLongSide)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new PhotoError('Браузер не смог обработать фото. Попробуй другой браузер.')
  ctx.fillStyle = '#ffffff' // прозрачный PNG → белый фон
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  // Canvas не переносит EXIF/GPS — результат без метаданных.
  let blob: Blob | null = null
  for (const q of [0.88, 0.8, 0.72, 0.64]) {
    blob = await toBlob(canvas, q)
    if (blob && blob.size <= INPUT_LIMITS.targetBytes) break
  }
  if (!blob) throw new PhotoError('Не получилось подготовить фото. Попробуй другое.')
  return { blob, width, height, originalName: file.name }
}
