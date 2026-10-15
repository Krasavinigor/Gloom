import { recognitionHandlers } from '@/server/http/recognition-runtime-handlers';
export const runtime = 'nodejs';
export async function GET(request: Request, context: RouteContext<'/api/operations/[id]'>) {
  return recognitionHandlers.get(request, (await context.params).id);
}
