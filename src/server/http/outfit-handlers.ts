import { z } from 'zod';
import { localeFromRequest } from '../../i18n/core';
import { outfitRoleSchema, type OutfitRole } from '../../features/outfits/schema';
import type { OutfitsService } from '../outfits/service';
import { readJson } from './body';
import { ApiError, errorResponse, successResponse } from './errors';
import { guardRequest } from './guard';

const outfitIdSchema = z.string().trim().min(1).max(100);
const replacementSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative().max(2_147_483_647),
  garmentId: z.uuid(),
});
async function handle(
  request: Request,
  bucket: 'read' | 'mutation',
  work: () => Promise<Response>,
) {
  try {
    guardRequest(request, bucket);
    return await work();
  } catch (error) {
    if (!request.body?.locked) void request.body?.cancel().catch(() => undefined);
    return errorResponse(error, localeFromRequest(request));
  }
}
async function target(service: OutfitsService, outfitId: string, slot: OutfitRole) {
  const view = await service.get();
  const item = view.result?.outfits
    .find((outfit) => outfit.id === outfitId)
    ?.items.find((item) => item.role === slot);
  if (!item) throw new ApiError('OUTFIT_NOT_FOUND', 404, 'Образ или выбранная роль не найдены.');
  return item.garmentId;
}
export function createOutfitHandlers(runtime: () => Promise<OutfitsService>) {
  return {
    get: (request: Request) =>
      handle(request, 'read', async () => successResponse(await (await runtime()).get())),
    start: (request: Request) =>
      handle(request, 'mutation', async () => {
        const key = z.uuid().parse(request.headers.get('Idempotency-Key'));
        z.strictObject({}).parse(await readJson(request));
        const operation = await (await runtime()).start(key, localeFromRequest(request));
        return successResponse(operation, 202, `/api/operations/${operation.id}`);
      }),
    alternatives: (request: Request, id: string) =>
      handle(request, 'read', async () => {
        const outfitId = outfitIdSchema.parse(id);
        const slot = outfitRoleSchema.parse(new URL(request.url).searchParams.get('slot'));
        const service = await runtime();
        const result = await service.alternatives(outfitId, await target(service, outfitId, slot));
        return successResponse({ revision: result.revision, candidates: result.garments });
      }),
    replace: (request: Request, id: string, rawSlot: string) =>
      handle(request, 'mutation', async () => {
        const outfitId = outfitIdSchema.parse(id);
        const slot = outfitRoleSchema.parse(rawSlot);
        const body = replacementSchema.parse(await readJson(request));
        const service = await runtime();
        return successResponse(
          await service.replace(
            {
              outfitId,
              garmentId: await target(service, outfitId, slot),
              replacementId: body.garmentId,
              expectedRevision: body.expectedRevision,
            },
            localeFromRequest(request),
          ),
        );
      }),
  };
}
