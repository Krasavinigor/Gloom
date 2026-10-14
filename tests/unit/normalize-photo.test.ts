import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizePhoto, PHOTO_MAX_BYTES } from '../../src/server/storage/normalize-photo';

const picture = () => sharp({ create: { width: 120, height: 80, channels: 3, background: '#346755' } });

afterEach(() => { vi.restoreAllMocks(); });

function animationControlChunk(): Buffer {
  const chunk = Buffer.alloc(20);
  chunk.writeUInt32BE(8, 0);
  chunk.write('acTL', 4, 'ascii');
  chunk.writeUInt32BE(2, 8);
  let checksum = 0xffffffff;
  for (const byte of chunk.subarray(4, 16)) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((checksum ^ 0xffffffff) >>> 0, 16);
  return chunk;
}

describe('photo normalization', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('accepts actual %s bytes and creates two JPEG copies', async (format) => {
    const result = await normalizePhoto(await picture()[format]().toBuffer());
    expect([result.width, result.height, result.aiWidth, result.aiHeight]).toEqual([120, 80, 120, 80]);
    for (const copy of [result.display, result.ai]) {
      expect(await sharp(copy).metadata()).toMatchObject({ format: 'jpeg', width: 120, height: 80 });
    }
  });

  it('applies EXIF orientation and removes all original metadata', async () => {
    const input = await picture().withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Artist: 'Private owner', Copyright: 'Private metadata' } }).jpeg().toBuffer();
    const result = await normalizePhoto(input);
    expect([result.width, result.height]).toEqual([80, 120]);
    for (const copy of [result.display, result.ai]) {
      const metadata = await sharp(copy).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
    }
  });

  it('bounds both copies without stretching their aspect ratio', async () => {
    const input = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#fff' } }).png().toBuffer();
    const result = await normalizePhoto(input);
    expect([result.width, result.height]).toEqual([2048, 1365]);
    expect([result.aiWidth, result.aiHeight]).toEqual([1536, 1024]);
  });

  it('rejects empty, corrupt and unsupported byte content', async () => {
    for (const input of [Buffer.alloc(0), Buffer.from('a fake JPEG'), await picture().tiff().toBuffer()]) {
      await expect(normalizePhoto(input)).rejects.toMatchObject({ code: 'INVALID_PHOTO', status: 422 });
    }
  });

  it('rejects oversized bytes before decoding', async () => {
    await expect(normalizePhoto(Buffer.alloc(PHOTO_MAX_BYTES + 1)))
      .rejects.toMatchObject({ code: 'PHOTO_TOO_LARGE', status: 413 });
  });

  it('rejects an image exceeding either the side or total-pixel limit', async () => {
    const tooWide = await sharp({ create: { width: 8193, height: 1, channels: 3, background: '#fff' } }).png().toBuffer();
    const tooManyPixels = await sharp({ create: { width: 8000, height: 5001, channels: 3, background: '#fff' } }).png().toBuffer();
    for (const input of [tooWide, tooManyPixels]) {
      await expect(normalizePhoto(input)).rejects.toMatchObject({ code: 'PHOTO_DIMENSIONS', status: 422 });
    }
  });

  it('rejects animated WebP instead of silently retaining its first frame', async () => {
    const pixels = Buffer.concat([Buffer.alloc(4 * 4 * 3, 0), Buffer.alloc(4 * 4 * 3, 255)]);
    const input = await sharp(pixels, {
      raw: { width: 4, height: 8, channels: 3, pageHeight: 4 },
    }).webp({ delay: [100, 200], loop: 0 }).toBuffer();
    expect((await sharp(input).metadata()).pages).toBe(2);
    await expect(normalizePhoto(input)).rejects.toMatchObject({ code: 'ANIMATED_PHOTO', status: 422 });
  });

  it('rejects an APNG animation marker even when the decoder exposes only a static PNG', async () => {
    const png = await picture().png().toBuffer();
    const input = Buffer.concat([png.subarray(0, 33), animationControlChunk(), png.subarray(33)]);
    expect((await sharp(input).metadata()).format).toBe('png');
    await expect(normalizePhoto(input)).rejects.toMatchObject({ code: 'ANIMATED_PHOTO', status: 422 });
  });

  it('rejects truncated image data that exposes readable metadata', async () => {
    const png = await picture().png().toBuffer();
    await expect(normalizePhoto(png.subarray(0, png.length - 30)))
      .rejects.toMatchObject({ code: 'INVALID_PHOTO', status: 422 });
  });

  it('bounds native processing time for each normalized copy', async () => {
    const input = await picture().png().toBuffer();
    const timeout = vi.spyOn(sharp.prototype, 'timeout');
    await normalizePhoto(input);
    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenNthCalledWith(1, { seconds: 30 });
    expect(timeout).toHaveBeenNthCalledWith(2, { seconds: 30 });
  });

  it('returns a retryable safe error when native processing reaches its timeout', async () => {
    const input = await picture().png().toBuffer();
    vi.spyOn(sharp.prototype, 'timeout').mockImplementationOnce(() => {
      throw new Error('timeout: 10% complete');
    });
    await expect(normalizePhoto(input)).rejects.toMatchObject({ code: 'PHOTO_TIMEOUT', status: 503 });
  });
});
