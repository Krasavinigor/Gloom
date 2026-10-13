import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
export function PersonalEmpty({ kind, aiEnabled, databaseConfigured }: { kind: 'wardrobe' | 'outfits'; aiEnabled: boolean; databaseConfigured: boolean }) {
  const wardrobe = kind === 'wardrobe';
  return <>
    <p className="mb-3 text-xs uppercase tracking-[0.2em] text-emerald-800">{wardrobe ? 'Ваши вещи — основа каждого образа' : 'Что надеть сегодня'}</p>
    <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{wardrobe ? 'Мой гардероб' : 'Образы на день'}</h1>
    <p className="mt-4 max-w-xl text-sm leading-6 text-stone-500">{wardrobe ? 'Здесь будут ваши вещи, фотографии и описания. Пока можно познакомиться с подбором в демонстрации.' : 'Здесь появятся образы из вашего гардероба с учётом погоды на ближайшие три часа.'}</p>
    <Card className="mt-8 flex min-h-80 flex-col items-center justify-center bg-[#efeee7] p-8 text-center"><span aria-hidden="true" className="mb-6 grid size-16 place-items-center rounded-full bg-white text-3xl text-emerald-900">{wardrobe ? '▱' : '☀'}</span><h2 className="text-xl font-semibold">{wardrobe ? 'В гардеробе пока нет вещей' : 'Начните со знакомства с демо'}</h2><p className="mt-3 max-w-md text-sm leading-6 text-stone-500">Личный режим ещё готовится. {wardrobe ? 'Загрузка и редактирование станут доступны на следующем этапе.' : 'Подбор из ваших вещей станет доступен после подключения гардероба.'}</p><Button asChild className="mt-6"><Link href={wardrobe ? '/demo/wardrobe' : '/demo'}>{wardrobe ? 'Открыть демогардероб' : 'Посмотреть демо'}</Link></Button></Card>
    {(!aiEnabled || !databaseConfigured) && <p className="mt-5 text-xs leading-5 text-stone-500">Демонстрация доступна независимо от настройки личного режима.</p>}
  </>;
}
