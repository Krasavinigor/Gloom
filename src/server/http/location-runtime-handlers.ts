import 'server-only';
import { getLocationWeatherService } from '../location/runtime';
import { createLocationHandlers } from './location-handlers';
export const locationHandlers = createLocationHandlers(getLocationWeatherService);
