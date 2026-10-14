import { wardrobeHandlers } from '@/server/http/runtime-handlers';
export const runtime = 'nodejs';
export async function GET(request: Request, context: RouteContext<'/api/garment-drafts/[id]'>) {
  return wardrobeHandlers.draftGet(request, (await context.params).id);
}
export async function DELETE(request: Request, context: RouteContext<'/api/garment-drafts/[id]'>) {
  return wardrobeHandlers.draftCancel(request, (await context.params).id);
}
