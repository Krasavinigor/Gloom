import { wardrobeHandlers } from '@/server/http/runtime-handlers';
export const runtime = 'nodejs';
export async function PATCH(request: Request, context: RouteContext<'/api/garments/[id]'>) {
  return wardrobeHandlers.update(request, (await context.params).id);
}
export async function DELETE(request: Request, context: RouteContext<'/api/garments/[id]'>) {
  return wardrobeHandlers.delete(request, (await context.params).id);
}
