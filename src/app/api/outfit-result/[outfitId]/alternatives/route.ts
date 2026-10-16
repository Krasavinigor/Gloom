import { outfitHandlers } from '@/server/http/outfit-runtime-handlers';
export const runtime = 'nodejs';
export async function GET(request: Request, context: RouteContext<'/api/outfit-result/[outfitId]/alternatives'>) {
  return outfitHandlers.alternatives(request, (await context.params).outfitId);
}
