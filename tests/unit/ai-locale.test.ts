import { describe, expect, it, vi } from 'vitest';
import { createRecognitionProvider } from '../../src/server/recognition/provider';
import { getErrorMessage } from '../../src/i18n/errors';
import { outfitClient } from '../../src/features/outfits/client';
import { errorResponse, ApiError } from '../../src/server/http/errors';

describe('AI output locale and safe HTTP messages', () => {
  it('preserves structured preflight details in the client without another request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          success: false,
          error: {
            code: 'INCOMPLETE_WARDROBE',
            message: 'server locale text',
            details: { missingRoles: ['bottom'], warm: false },
          },
        },
        { status: 409 },
      ),
    );
    try {
      const error = await outfitClient.start('key').catch((failure: unknown) => failure);
      expect(getErrorMessage('en', error)).toContain('Bottom');
      expect(getErrorMessage('ru', error)).toContain('Низ');
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      fetch.mockRestore();
    }
  });
  it('keeps validated missing roles and translates them after a locale switch', async () => {
    const details = { missingRoles: ['footwear', 'outer'], warm: true };
    const response = errorResponse(
      new ApiError('INCOMPLETE_WARDROBE', 409, 'private internal text', details),
    );
    const body = await response.json();
    expect(body.error.details).toEqual(details);
    expect(body.error.message).toContain('Footwear (warm)');
    expect(getErrorMessage('ru', body.error)).toContain('Обувь (тёплая)');
    expect(getErrorMessage('ru', body.error)).toContain('Верхняя одежда (тёплая)');
    expect(body.error.message).not.toContain('private');
    const invalid = errorResponse(
      new ApiError('INCOMPLETE_WARDROBE', 409, 'private', {
        missingRoles: ['secret-path'],
        warm: true,
      }),
    );
    expect(await invalid.json()).not.toHaveProperty('error.details');
  });
  it.each(['en', 'ru'] as const)(
    'freezes %s in a recognition request and its result',
    async (outputLocale) => {
      const create = vi.fn().mockResolvedValue({
        id: 'resp_test',
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({ kind: 'not_clothing', fields: null, warnings: [] }),
              },
            ],
          },
        ],
      });
      const provider = createRecognitionProvider({
        apiKey: 'test',
        client: { responses: { create } },
      });
      const result = await provider({
        photo: Buffer.from([0xff, 0xd8, 0xff]),
        signal: new AbortController().signal,
        outputLocale,
      });
      expect(result.proposal).toMatchObject({ outputLocale });
      expect(JSON.stringify(create.mock.calls[0][0])).toContain(
        outputLocale === 'en' ? 'in English' : 'in Russian',
      );
    },
  );

  it('returns English by default without leaking internal operational messages', async () => {
    const response = errorResponse(new ApiError('AI_DISABLED', 503, 'Секретный русский текст'));
    expect(await response.json()).toMatchObject({
      error: { code: 'AI_DISABLED', message: expect.stringContaining('AI') },
    });
    const russian = errorResponse(
      new ApiError('AI_DISABLED', 503, 'Секретный русский текст'),
      'ru',
    );
    expect(JSON.stringify(await russian.json())).not.toContain('Секретный');
  });
});
