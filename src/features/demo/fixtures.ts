export type DemoItem = Readonly<{ id: string; name: string; category: string; bodyPart: 'torso' | 'legs' | 'feet' | 'head'; season: string; temperature: string; image: string; color: string }>;
const item = (id: string, name: string, category: string, bodyPart: DemoItem['bodyPart'], season: string, temperature: string, color: string): DemoItem => ({ id, name, category, bodyPart, season, temperature, color, image: `/demo/items/${id}.svg` });
export const demoItems: readonly DemoItem[] = [
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
export const demoScenarios: readonly DemoScenario[] = [
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
export function getDemoItem(id: string): DemoItem {
  const found = demoItems.find(value => value.id === id);
  if (!found) throw new Error(`Unknown demonstration garment: ${id}`);
  return found;
}
