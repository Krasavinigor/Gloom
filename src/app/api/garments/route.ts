import { wardrobeHandlers } from '@/server/http/runtime-handlers';
export const runtime = 'nodejs';
export const GET = wardrobeHandlers.list;
export const POST = wardrobeHandlers.save;
