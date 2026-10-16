import { outfitHandlers } from '@/server/http/outfit-runtime-handlers';
export const runtime = 'nodejs';
export async function PATCH(request: Request, context: RouteContext<'/api/outfit-result/[outfitId]/slots/[slot]'>) {
  const { outfitId, slot } = await context.params;
  return outfitHandlers.replace(request, outfitId, slot);
}
