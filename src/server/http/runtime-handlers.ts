import 'server-only';
import { getWardrobeService } from '../wardrobe/runtime';
import { createWardrobeHandlers } from './wardrobe-handlers';

export const wardrobeHandlers = createWardrobeHandlers(getWardrobeService);
