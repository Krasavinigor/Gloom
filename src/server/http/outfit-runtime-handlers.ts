import 'server-only';
import { getOutfitsService } from '../outfits/runtime';
import { createOutfitHandlers } from './outfit-handlers';
export const outfitHandlers = createOutfitHandlers(getOutfitsService);
