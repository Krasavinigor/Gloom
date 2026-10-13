import Link from 'next/link';
import { OutfitCard } from './outfit-card';
import type { DemoScenario } from './fixtures';

export function DemoHeading() {
  return (
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-emerald-800">Что надеть сегодня</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">День начинается с вас.</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-stone-500 sm:text-base">
            Выберите погоду и посмотрите, как вещи из гардероба складываются в образы.
          </p>
        </div>
        <Link href="/demo/wardrobe" className="text-sm font-medium text-emerald-900 underline underline-offset-4">
          15 вещей в демогардеробе ↗
        </Link>
      </div>
  );
}

export function DemoWeather({ scenario }: { scenario: DemoScenario }) {
  const weatherDetails = [
    ['Ощущается', scenario.feelsLike],
    ['Ветер', scenario.wind],
    ['Осадки', scenario.rain],
  ];
  return (
      <section aria-labelledby="weather-heading" className="overflow-hidden rounded-3xl border border-stone-200 bg-[#eae9d5]">
        <div
          className="weather-hero relative p-6 sm:p-8"
          style={{
            backgroundImage: `linear-gradient(90deg, rgba(250,249,245,.98) 0%, rgba(250,249,245,.93) 36%, rgba(250,249,245,.25) 100%), url('${scenario.background}')`,
          }}
        >
          <div className="relative max-w-md">
            <p className="text-xs uppercase tracking-[0.16em] text-stone-500">
              Демонстрация: пример погодных условий
            </p>
            <h2 id="weather-heading" className="mt-3 text-base font-semibold">{scenario.label}</h2>
            <div className="mt-1 flex items-center gap-5">
              <span className="text-6xl font-medium tracking-tight sm:text-7xl">{scenario.temperature}</span>
              <span aria-hidden="true" className="text-5xl text-emerald-800">{scenario.symbol}</span>
            </div>
            <p className="mt-4 text-sm leading-6 text-stone-600">{scenario.description}</p>
          </div>
        </div>
        <dl className="grid grid-cols-3 border-t border-stone-200/80 bg-white/75 px-4 py-5 sm:px-8">
          {weatherDetails.map(([title, value]) => (
            <div key={title} className="border-r border-stone-200 px-2 last:border-0 sm:px-4">
              <dt className="text-xs text-stone-500">{title}</dt>
              <dd className="mt-1 text-sm font-semibold sm:text-base">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
  );
}

export function DemoResults({ selected, scenario }: { selected: boolean; scenario: DemoScenario }) {
  return (
      <section aria-label="Результат подбора" aria-live="polite" className="mt-10">
        {selected ? (
          <>
            <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-2xl font-semibold tracking-tight">Ваши образы</h2>
              <p className="text-xs text-stone-500">
                {scenario.outfits.length} варианта · повседневная прогулка
              </p>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              {scenario.outfits.map((outfit, index) => (
                <OutfitCard key={outfit.id} outfit={outfit} index={index} />
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-dashed border-stone-300 px-6 py-8">
            <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-stone-100 text-2xl text-stone-500">↗</span>
            <div>
              <h2 className="font-semibold">Всё готово к подбору</h2>
              <p className="mt-1 text-sm text-stone-500">
                Нажмите «Подобрать образы», когда выберете сценарий погоды.
              </p>
            </div>
          </div>
        )}
      </section>
  );
}
