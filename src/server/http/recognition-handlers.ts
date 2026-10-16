import { z } from 'zod';
import { localeFromRequest } from '../../i18n/core';
import type { OperationEventHub } from '../operations/events';
import { createOperationEventStream } from '../operations/event-stream';
import type { OperationsRepository } from '../operations/repository';
import type { RecognitionService } from '../recognition/service';
import { readJson } from './body';
import { ApiError, errorResponse, privateHeaders, successResponse } from './errors';
import { guardRequest } from './guard';

export type RecognitionHttpRuntime = {
  repository: OperationsRepository;
  recognition: RecognitionService;
  eventHub: OperationEventHub;
};
const uuid = z.uuid();
const idsSchema = z
  .array(uuid)
  .min(1)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length);
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

export function createRecognitionHandlers(runtime: () => Promise<RecognitionHttpRuntime>) {
  return {
    start: (request: Request, id: string) =>
      handle(request, 'mutation', async () => {
        const draftId = uuid.parse(id);
        const key = uuid.parse(request.headers.get('Idempotency-Key'));
        if (request.body) z.strictObject({}).parse(await readJson(request));
        const operation = await (
          await runtime()
        ).recognition.start(draftId, key, localeFromRequest(request));
        return successResponse(operation, 202, `/api/operations/${operation.id}`);
      }),
    get: (request: Request, id: string) =>
      handle(request, 'read', async () => {
        const operationId = uuid.parse(id);
        const operation = await (await runtime()).repository.get(operationId);
        if (!operation) throw new ApiError('NOT_FOUND', 404, 'Задача не найдена.');
        return successResponse(operation);
      }),
    budget: (request: Request) =>
      handle(request, 'read', async () =>
        successResponse(await (await runtime()).repository.budget()),
      ),
    events: (request: Request) =>
      handle(request, 'read', async () => {
        const ids = idsSchema.parse(
          (new URL(request.url).searchParams.get('ids') ?? '').split(','),
        );
        const { repository, eventHub } = await runtime();
        if ((await repository.snapshots(ids)).length !== ids.length)
          throw new ApiError('NOT_FOUND', 404, 'Одна из задач не найдена.');
        await eventHub.ready();
        const stream = createOperationEventStream({
          ids,
          signal: request.signal,
          hub: eventHub,
          readSnapshots: (requested) => repository.snapshots(requested),
        });
        return new Response(stream, {
          headers: {
            ...privateHeaders,
            'Content-Type': 'text/event-stream; charset=utf-8',
            'X-Accel-Buffering': 'no',
            Connection: 'keep-alive',
          },
        });
      }),
  };
}
