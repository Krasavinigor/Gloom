import { wardrobeHandlers } from '@/server/http/runtime-handlers';
export const runtime = 'nodejs';
export async function POST(request: Request, context: RouteContext<'/api/garments/[id]/cleanup'>) {
  return wardrobeHandlers.retryCleanup(request, (await context.params).id);
}
