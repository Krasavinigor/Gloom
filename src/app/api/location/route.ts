import { locationHandlers } from '@/server/http/location-runtime-handlers';
export const runtime = 'nodejs';
export const GET = locationHandlers.get;
export const PUT = locationHandlers.select;
