import sharp from 'sharp';

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_SIDE = 8192;
const DECODE_OPTIONS = { limitInputPixels: MAX_PIXELS, failOn: 'warning' as const };

export class PhotoError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = 'PhotoError';
  }
}

export type NormalizedPhoto = Readonly<{
  display: Buffer;
  ai: Buffer;
  width: number;
  height: number;
  aiWidth: number;
  aiHeight: number;
}>;

function isAnimatedPng(input: Buffer): boolean {
  let offset = 8;
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    if (length > input.length - offset - 12) return false;
    if (input.toString('ascii', offset + 4, offset + 8) === 'acTL') return true;
    offset += length + 12;
  }
  return false;
}

async function jpegCopy(input: Buffer, side: number) {
  return sharp(input, DECODE_OPTIONS).autoOrient()
    .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 85 })
    .timeout({ seconds: 30 })
    .toBuffer({ resolveWithObject: true });
}

export async function normalizePhoto(input: Buffer): Promise<NormalizedPhoto> {
  if (input.length > PHOTO_MAX_BYTES) {
    throw new PhotoError('PHOTO_TOO_LARGE', 'Фотография должна быть не больше 10 МБ.', 413);
  }
  try {
    const metadata = await sharp(input, DECODE_OPTIONS).metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height) {
      throw new PhotoError('INVALID_PHOTO', 'Загрузите корректную фотографию JPEG, PNG или WebP.', 422);
    }
    if ((metadata.pages ?? 1) > 1 || (metadata.format === 'png' && isAnimatedPng(input))) {
      throw new PhotoError('ANIMATED_PHOTO', 'Анимированные фотографии не поддерживаются.', 422);
    }
    if (Math.max(metadata.width, metadata.height) > MAX_SIDE || metadata.width * metadata.height > MAX_PIXELS) {
      throw new PhotoError('PHOTO_DIMENSIONS', 'Фотография должна быть не больше 40 Мп и 8192 пикселей по стороне.', 422);
    }
    const display = await jpegCopy(input, 2048);
    const ai = await jpegCopy(input, 1536);
    return { display: display.data, ai: ai.data, width: display.info.width, height: display.info.height,
      aiWidth: ai.info.width, aiHeight: ai.info.height };
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    if (error instanceof Error && error.message.includes('timeout')) {
      throw new PhotoError('PHOTO_TIMEOUT', 'Обработка фотографии заняла слишком много времени. Попробуйте загрузить её ещё раз.', 503);
    }
    if (error instanceof Error && error.message.includes('exceeds pixel limit')) {
      throw new PhotoError('PHOTO_DIMENSIONS', 'Фотография должна быть не больше 40 Мп и 8192 пикселей по стороне.', 422);
    }
    throw new PhotoError('INVALID_PHOTO', 'Не удалось прочитать фотографию. Загрузите JPEG, PNG или WebP.', 422);
  }
}
