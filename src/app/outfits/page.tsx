import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';
import { OutfitsWorkbench } from '@/features/outfits/outfits-workbench';
import type { LocationState } from '@/features/location/schema';
import type { WeatherSnapshot } from '@/features/weather/schema';
import { getLocationWeatherService } from '@/server/location/runtime';
import { errorResponse } from '@/server/http/errors';
import { getOutfitsService } from '@/server/outfits/runtime';
import type { OutfitState } from '@/server/outfits/repository';
import { parseServerEnvironment } from '@/server/config/environment';
export const metadata: Metadata = { title: 'Образы на день' };
export const dynamic = 'force-dynamic';
export default async function OutfitsPage() {
  let initialLocation: LocationState | undefined;
  let initialWeather: WeatherSnapshot | undefined;
  let initialError: string | undefined;
  let initialResult: OutfitState | undefined;
  try {
    const context = await (await getLocationWeatherService()).context();
    initialLocation = context.location;
    initialWeather = context.weather ?? undefined;
    initialResult = await (await getOutfitsService()).get();
  } catch (error) {
    initialError = (await errorResponse(error).json()).error.message;
  }
  return (
    <AppShell mode="personal" active="outfits">
      <OutfitsWorkbench
        initialLocation={initialLocation}
        initialWeather={initialWeather}
        initialError={initialError}
        initialResult={initialResult}
        aiEnabled={parseServerEnvironment(process.env).aiEnabled}
        // This dynamic Server Component serializes one request-time clock value for stable hydration.
        // eslint-disable-next-line react-hooks/purity
        initialNow={Date.now()}
      />
    </AppShell>
  );
}
