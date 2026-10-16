import type { Locale } from '@/i18n/core';

export type DemoItem = Readonly<{ id: string; name: string; category: string; bodyPart: 'torso' | 'legs' | 'feet' | 'head'; season: string; temperature: string; image: string; color: string }>;
const item = (id: string, name: string, category: string, bodyPart: DemoItem['bodyPart'], season: string, temperature: string, color: string): DemoItem => ({ id, name, category, bodyPart, season, temperature, color, image: `/demo/items/${id}.svg` });
const russianItems: readonly DemoItem[] = [
  item('tee', 'Молочная футболка', 'Футболка', 'torso', 'Лето', '+18…+28 °C', 'Молочный'),
  item('shirt', 'Льняная рубашка', 'Рубашка', 'torso', 'Лето', '+18…+27 °C', 'Песочный'),
  item('sweater', 'Шалфейный джемпер', 'Джемпер', 'torso', 'Весна / осень', '+8…+18 °C', 'Шалфей'),
  item('hoodie', 'Серое худи', 'Худи', 'torso', 'Весна / осень', '+10…+19 °C', 'Серый'),
  item('windbreaker', 'Оливковая ветровка', 'Ветровка', 'torso', 'Весна / осень', '+10…+20 °C', 'Оливковый'),
  item('raincoat', 'Синий дождевик', 'Дождевик', 'torso', 'Весна / осень', '+8…+20 °C', 'Синий'),
  item('coat', 'Песочное пальто', 'Пальто', 'torso', 'Весна / осень', '+3…+13 °C', 'Песочный'),
  item('jeans', 'Прямые джинсы', 'Джинсы', 'legs', 'Весна / осень', '+7…+23 °C', 'Индиго'),
  item('chinos', 'Бежевые чиносы', 'Брюки', 'legs', 'Весна / осень', '+12…+25 °C', 'Бежевый'),
  item('shorts', 'Льняные шорты', 'Шорты', 'legs', 'Лето', '+20…+30 °C', 'Песочный'),
  item('sneakers', 'Белые кеды', 'Кеды', 'feet', 'Весна / лето', '+12…+27 °C', 'Белый'),
  item('boots', 'Кожаные ботинки', 'Ботинки', 'feet', 'Весна / осень', '+3…+17 °C', 'Коричневый'),
  item('sandals', 'Сандалии', 'Сандалии', 'feet', 'Лето', '+22…+32 °C', 'Коричневый'),
  item('cap', 'Песочная кепка', 'Кепка', 'head', 'Лето', '+18…+30 °C', 'Песочный'),
  item('beanie', 'Трикотажная шапка', 'Шапка', 'head', 'Весна / осень', '+1…+12 °C', 'Шалфей'),
];
export type DemoOutfit = Readonly<{ id: string; name: string; explanation: string; itemIds: readonly string[]; note?: string }>;
export type DemoScenario = Readonly<{ id: string; label: string; symbol: string; temperature: string; feelsLike: string; wind: string; rain: string; description: string; background: string; outfits: readonly DemoOutfit[]; answer: string }>;
const russianScenarios: readonly DemoScenario[] = [
  { id: 'warm', label: 'Тепло', symbol: '☀', temperature: '+24°', feelsLike: '+24 °C', wind: '6 км/ч', rain: '0 мм', description: 'Солнечный день и лёгкий ветер. Самое время для свободных вещей и светлых оттенков.', background: '/demo/backgrounds/warm.svg', outfits: [
    { id: 'light', name: 'Лёгкий день', explanation: 'Футболка и льняные шорты подходят для тепла. Кеды удобны для повседневной прогулки, кепка прикрывает голову от солнца.', itemIds: ['tee', 'shorts', 'sneakers', 'cap'] },
    { id: 'linen', name: 'В ритме города', explanation: 'Льняная рубашка и чиносы дают больше покрытия, сохраняя лёгкость. Сандалии подходят для сухой тёплой погоды.', itemIds: ['shirt', 'chinos', 'sandals'] },
  ], answer: 'В этом примере +24 °C и сухо, поэтому выбраны лёгкие вещи. Для более закрытого образа есть льняная рубашка и чиносы.' },
  { id: 'wind', label: 'Ветрено', symbol: '≋', temperature: '+14°', feelsLike: '+11 °C', wind: '28 км/ч', rain: '0 мм', description: 'Прохладный воздух и порывистый ветер. Съёмный внешний слой пригодится на прогулке.', background: '/demo/backgrounds/wind.svg', outfits: [
    { id: 'layers', name: 'Лёгкие слои', explanation: 'Футболка и джемпер позволяют снять слой в помещении. Ветровка защищает от ветра, джинсы и ботинки дают больше покрытия.', itemIds: ['tee', 'sweater', 'windbreaker', 'jeans', 'boots'] },
    { id: 'calm', name: 'Спокойный маршрут', explanation: 'Худи и ветровка подходят для прохладного ветра. Чиносы и кеды завершают повседневный комплект.', itemIds: ['hoodie', 'windbreaker', 'chinos', 'sneakers'] },
  ], answer: 'В этом примере ветер усиливает ощущение прохлады. Ветровка — внешний слой, а джемпер или худи помогают сохранить тепло.' },
  { id: 'rain', label: 'Дождливо', symbol: '☂', temperature: '+12°', feelsLike: '+10 °C', wind: '18 км/ч', rain: '2,4 мм', description: 'Небольшой дождь и прохлада. Выбираем закрытую обувь и внешний слой от осадков.', background: '/demo/backgrounds/rain.svg', outfits: [
    { id: 'shelter', name: 'Под защитой', explanation: 'Джемпер под дождевиком сохраняет тепло. Джинсы и закрытые ботинки завершают образ для прохладного дождливого дня.', itemIds: ['sweater', 'raincoat', 'jeans', 'boots'], note: 'В демо защита дождевика подтверждена заранее. В личном гардеробе свойства нужно проверять; водонепроницаемость ботинок здесь не заявлена.' },
  ], answer: 'В этом примере дождевик защищает от небольшого дождя, а джемпер добавляет тепла. Ботинки закрытые, но их водонепроницаемость неизвестна.' },
];
const englishItemText: Readonly<Record<string, readonly [string, string, string, string]>> = {
  tee: ['Cream T-shirt', 'T-shirt', 'Summer', 'Cream'],
  shirt: ['Linen shirt', 'Shirt', 'Summer', 'Sand'],
  sweater: ['Sage sweater', 'Sweater', 'Spring / autumn', 'Sage'],
  hoodie: ['Grey hoodie', 'Hoodie', 'Spring / autumn', 'Grey'],
  windbreaker: ['Olive windbreaker', 'Windbreaker', 'Spring / autumn', 'Olive'],
  raincoat: ['Blue raincoat', 'Raincoat', 'Spring / autumn', 'Blue'],
  coat: ['Sand coat', 'Coat', 'Spring / autumn', 'Sand'],
  jeans: ['Straight jeans', 'Jeans', 'Spring / autumn', 'Indigo'],
  chinos: ['Beige chinos', 'Trousers', 'Spring / autumn', 'Beige'],
  shorts: ['Linen shorts', 'Shorts', 'Summer', 'Sand'],
  sneakers: ['White trainers', 'Trainers', 'Spring / summer', 'White'],
  boots: ['Leather boots', 'Boots', 'Spring / autumn', 'Brown'],
  sandals: ['Sandals', 'Sandals', 'Summer', 'Brown'],
  cap: ['Sand cap', 'Cap', 'Summer', 'Sand'],
  beanie: ['Knitted beanie', 'Beanie', 'Spring / autumn', 'Sage'],
};
const englishItems: readonly DemoItem[] = russianItems.map(value => {
  const [name, category, season, color] = englishItemText[value.id]!;
  return { ...value, name, category, season, color };
});
const englishScenarios: readonly DemoScenario[] = [
  { ...russianScenarios[0]!, label: 'Warm', wind: '6 km/h', rain: '0 mm',
    description: 'A sunny day with a light breeze. A good moment for relaxed pieces and light colours.',
    outfits: [
      { ...russianScenarios[0]!.outfits[0]!, name: 'A light day', explanation: 'A T-shirt and linen shorts suit the warmth. Trainers are comfortable for a casual walk, and a cap covers your head in the sun.' },
      { ...russianScenarios[0]!.outfits[1]!, name: 'City rhythm', explanation: 'A linen shirt and chinos offer more coverage while staying light. Sandals suit dry, warm weather.' },
    ], answer: 'This example is dry and +24 °C, so the outfits use light pieces. A linen shirt and chinos offer a more covered option.' },
  { ...russianScenarios[1]!, label: 'Windy', wind: '28 km/h', rain: '0 mm',
    description: 'Cool air and gusty wind. A removable outer layer will come in handy on your walk.',
    outfits: [
      { ...russianScenarios[1]!.outfits[0]!, name: 'Light layers', explanation: 'A T-shirt and sweater let you remove a layer indoors. The windbreaker protects against wind; jeans and boots offer more coverage.' },
      { ...russianScenarios[1]!.outfits[1]!, name: 'An easy route', explanation: 'A hoodie and windbreaker suit the cool breeze. Chinos and trainers complete the casual outfit.' },
    ], answer: 'In this example, wind makes it feel cooler. The windbreaker is an outer layer, while a sweater or hoodie helps retain warmth.' },
  { ...russianScenarios[2]!, label: 'Rainy', wind: '18 km/h', rain: '2.4 mm',
    description: 'Light rain and cool air. Choose closed shoes and an outer layer for the rain.',
    outfits: [
      { ...russianScenarios[2]!.outfits[0]!, name: 'Under cover', explanation: 'A sweater under a raincoat helps retain warmth. Jeans and closed boots complete the outfit for a cool, rainy day.', note: 'The raincoat’s rain protection is confirmed in this demo. Check properties in your own wardrobe; these boots are not claimed to be waterproof.' },
    ], answer: 'In this example, the raincoat protects against light rain and the sweater adds warmth. The boots are closed, but their waterproofing is unknown.' },
];
export function getDemoItems(locale: Locale = 'en'): readonly DemoItem[] {
  return locale === 'ru' ? russianItems : englishItems;
}
export function getDemoScenarios(locale: Locale = 'en'): readonly DemoScenario[] {
  return locale === 'ru' ? russianScenarios : englishScenarios;
}
export const demoItems = englishItems;
export const demoScenarios = englishScenarios;
export function getDemoItem(id: string, locale: Locale = 'en'): DemoItem {
  const found = getDemoItems(locale).find(value => value.id === id);
  if (!found) throw new Error(`Unknown demonstration garment: ${id}`);
  return found;
}
