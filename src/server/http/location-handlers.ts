import { z } from 'zod';
import { searchQuerySchema } from '../../features/location/schema';
import type { LocationWeatherService } from '../location/service';
import { readJson } from './body';
import { ApiError, errorResponse, successResponse } from './errors';
import { guardRequest } from './guard';

async function handle(request: Request, mutation: boolean, action: () => Promise<unknown>): Promise<Response> {
  try {
    guardRequest(request, mutation ? 'mutation' : 'read');
    return successResponse(await action());
  } catch (error) {
    if (!request.body?.locked) void request.body?.cancel().catch(() => undefined);
    return errorResponse(error instanceof z.ZodError
      ? new ApiError('invalid_location', 400, 'Проверьте параметры места и повторите действие.') : error);
  }
}

export function createLocationHandlers(service: () => Promise<LocationWeatherService>) {
  return {
    get: (request: Request) => handle(request, false, async () => (await service()).get()),
    search: (request: Request) => handle(request, false, async () => {
      const query = searchQuerySchema.parse(new URL(request.url).searchParams.get('query'));
      return (await service()).search(query);
    }),
    select: (request: Request) => handle(request, true, async () => {
      const input = await readJson(request);
      return (await service()).select(input);
    }),
    weather: (request: Request) => handle(request, false, async () => {
      const value = new URL(request.url).searchParams.get('locationVersion');
      if (!value || !/^\d{1,10}$/.test(value)) throw new ApiError('invalid_location', 400, 'Нужна актуальная версия выбранного места.');
      const version = z.number().int().nonnegative().max(2_147_483_647).parse(Number(value));
      return (await service()).forecast(version);
    }),
  };
}
