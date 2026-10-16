# Gloom

Локальный гардероб с распознаванием одежды через OpenAI и подбором образов по погоде.

## Подготовка

Нужны **Node.js 24**, **pnpm 12.11.2** и запущенный **Docker Desktop**.

```sh
nvm use
pnpm install --frozen-lockfile
cp -n .env.example .env.local
```

Заполни `.env.local`:

- `POSTGRES_PASSWORD` — случайный пароль для локальной БД.
- `DATABASE_URL` — `postgresql://wardrobe:<пароль>@127.0.0.1:55432/wardrobe`; пароль должен совпадать с `POSTGRES_PASSWORD` и быть URL-encoded.
- `ENABLE_AI=true` и `OPENAI_API_KEY` — для распознавания и подбора. С `ENABLE_AI=false` доступны ручной гардероб и демо.

Если ключ уже задан в `.env`, убери пустую строку `OPENAI_API_KEY=` из `.env.local`: она перекрывает ключ.

## Запуск

В первом терминале:

```sh
pnpm db:up
pnpm db:migrate
NODE_USE_SYSTEM_CA=1 pnpm dev
```

Для AI-функций во втором терминале из корня проекта:

```sh
NODE_USE_SYSTEM_CA=1 pnpm worker
```

Открой:

- [Гардероб](http://127.0.0.1:3000/wardrobe) — загрузка, описание и сохранение вещей.
- [Подбор образов](http://127.0.0.1:3000/outfits) — выбор города и ручной запуск подбора.
- [Демо](http://127.0.0.1:3000/demo) — готовые примеры без БД и OpenAI.

`NODE_USE_SYSTEM_CA=1` нужен на текущем Mac для доверия системным сертификатам. После изменения env перезапусти приложение и worker. AI вызывается только по явному действию; лимит приложения — $10 в месяц.

## Остановка и проверки

Приложение и worker останавливаются через `Ctrl+C`, БД — командой `pnpm db:stop`. Данные БД и фотографии в `.data/photos` сохраняются.

```sh
pnpm test
pnpm lint
pnpm typecheck
pnpm test:coverage # требует запущенной БД
```

Подробности, production-сборка и E2E: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
