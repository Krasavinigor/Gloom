import { recognitionHandlers } from '@/server/http/recognition-runtime-handlers';
export const runtime = 'nodejs';
export async function POST(request: Request, context: RouteContext<'/api/garment-drafts/[id]/recognition'>) {
  return recognitionHandlers.start(request, (await context.params).id);
}
