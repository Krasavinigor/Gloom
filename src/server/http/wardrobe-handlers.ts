import { z } from 'zod';
import { garmentFieldsSchema } from '../../features/wardrobe/schema';
import type { WardrobeService } from '../wardrobe/service';
import { readJson, readPhotoUpload } from './body';
import { errorResponse, privateHeaders, successResponse } from './errors';
import { guardRequest, withUploadSlot } from './guard';

const uuid = z.uuid();
const version = z.number().int().positive().max(2_147_483_647);
const save = z.strictObject({ draftId: uuid, fields: garmentFieldsSchema });
const edit = z.strictObject({ version, fields: garmentFieldsSchema });
const deletion = z.strictObject({ version });

async function handle(request: Request, bucket: 'read' | 'mutation' | 'upload', work: () => Promise<Response>): Promise<Response> {
  try { guardRequest(request, bucket); return await work(); }
  catch (error) {
    if (!request.body?.locked) void request.body?.cancel().catch(() => undefined);
    return errorResponse(error);
  }
}

export function createWardrobeHandlers(service: () => Promise<WardrobeService>) {
  return {
    list: (request: Request) => handle(request, 'read', async () => successResponse(await (await service()).list())),
    upload: (request: Request) => handle(request, 'upload', () => withUploadSlot(async () => {
      const input = await readPhotoUpload(request);
      const draft = await (await service()).upload(input);
      return successResponse(draft, 201, `/api/garment-drafts/${draft.id}`);
    })),
    draftGet: (request: Request, id: string) => handle(request, 'read', async () => {
      return successResponse(await (await service()).getDraft(uuid.parse(id)));
    }),
    draftCancel: (request: Request, id: string) => handle(request, 'mutation', async () => {
      return successResponse(await (await service()).cancelDraft(uuid.parse(id)));
    }),
    save: (request: Request) => handle(request, 'mutation', async () => {
      const body = save.parse(await readJson(request));
      const garment = await (await service()).saveDraft(body.draftId, body.fields);
      return successResponse(garment, 201, `/api/garments/${garment.id}`);
    }),
    update: (request: Request, id: string) => handle(request, 'mutation', async () => {
      const garmentId = uuid.parse(id);
      const body = edit.parse(await readJson(request));
      return successResponse(await (await service()).update(garmentId, body.version, body.fields));
    }),
    delete: (request: Request, id: string) => handle(request, 'mutation', async () => {
      const garmentId = uuid.parse(id);
      const body = deletion.parse(await readJson(request));
      return successResponse(await (await service()).deleteGarment(garmentId, body.version));
    }),
    retryCleanup: (request: Request, id: string) => handle(request, 'mutation', async () => {
      return successResponse(await (await service()).retryCleanup(uuid.parse(id)));
    }),
    asset: (request: Request, id: string) => handle(request, 'read', async () => {
      const photo = await (await service()).readAsset(uuid.parse(id));
      return new Response(new Uint8Array(photo), { headers: { ...privateHeaders, 'Content-Type': 'image/jpeg' } });
    }),
  };
}
