import { wardrobeHandlers } from '@/server/http/runtime-handlers';
export const runtime = 'nodejs';
export async function GET(request: Request, context: RouteContext<'/api/assets/[id]'>) {
  return wardrobeHandlers.asset(request, (await context.params).id);
}
