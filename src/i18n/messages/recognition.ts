import { defineMessages } from '@/i18n/core';
export const recognitionMessages = defineMessages(
  {
    region: 'Clothing recognition',
    heading: 'Description from photo',
    consent:
      'Clicking the button sends your photo to OpenAI. Review the suggested properties before saving. You can also complete everything manually.',
    disabled: 'AI is currently disabled. Describe the item manually using the fields below.',
    warning: 'At least $8 of the monthly AI budget is spent or reserved.',
    exhausted: 'The AI budget is spent or reserved. Manual descriptions remain available.',
    budgetError: 'Unable to check the AI budget. You can describe the item manually.',
    checkBudget: 'Check budget',
    running: 'Recognizing clothing…',
    queued: 'Waiting for recognition…',
    reconnecting: 'Reconnecting to the status feed. No new recognition request is being started.',
    starting: 'Starting…',
    active: 'Recognition in progress',
    checkStart: 'Check recognition request',
    again: 'Recognize again',
    recognize: 'Recognize clothing',
    paidRetry: 'Recognizing again makes a new paid request. Editing fields is free.',
    succeeded: 'Recognition complete. Review the description.',
    timedOut: 'The request timed out.',
    interrupted: 'Recognition was interrupted.',
    failed: 'Unable to recognize the item. Try another photo or describe it manually.',
    unknownPayment:
      'The payment outcome is unknown, so the budget reserve is retained. There is no automatic retry; manual descriptions remain available.',
    protection:
      'Rain and wind protection are unknown. Confirm them using the item’s specifications.',
    applyHelp:
      'Applying replaces the current form fields. You can edit the description before saving.',
    apply: 'Apply AI description to form',
    applied: 'Description copied to the form. Review it and save the item.',
    multiple:
      'The photo contains several items. Upload each item separately or describe it manually.',
    notFound: 'No clothing item was found. Choose another photo or describe the item manually.',
    estimate: 'Approximately {min}…{max} °C. This is an estimate, not a guarantee of comfort.',
    budget: 'Budget {month} (UTC): {spent} accounted for out of {limit}. Reserved: {reserved}.',
  },
  {
    region: 'Распознавание одежды',
    heading: 'Описание по фотографии',
    consent:
      'По кнопке фотография будет отправлена в OpenAI. Проверьте предложенные свойства перед сохранением. Можно заполнить всё вручную.',
    disabled: 'AI сейчас отключён. Опишите вещь вручную — все поля доступны ниже.',
    warning: 'Использовано или зарезервировано не менее $8 месячного бюджета AI.',
    exhausted: 'Бюджет AI исчерпан или зарезервирован. Ручное описание доступно.',
    budgetError: 'Не удалось проверить бюджет AI. Пока можно заполнить описание вручную.',
    checkBudget: 'Проверить бюджет',
    running: 'Распознаём одежду…',
    queued: 'Ожидаем распознавание…',
    reconnecting: 'Восстанавливаем связь со статусом. Новое распознавание не запускается.',
    starting: 'Запускаем…',
    active: 'Распознавание выполняется',
    checkStart: 'Проверить запуск распознавания',
    again: 'Распознать заново',
    recognize: 'Распознать одежду',
    paidRetry: 'Повторное распознавание — новый платный запрос. Исправление полей бесплатно.',
    succeeded: 'Распознавание завершено. Проверьте описание.',
    timedOut: 'Время ожидания истекло.',
    interrupted: 'Распознавание прервалось.',
    failed: 'Не удалось распознать вещь. Попробуйте другое фото или заполните описание вручную.',
    unknownPayment:
      'Результат оплаты пока неизвестен, резерв бюджета сохранён. Автоматического повтора нет; ручное описание доступно.',
    protection: 'Защита от дождя и ветра неизвестна. Подтвердите её по свойствам вещи.',
    applyHelp:
      'Применение заменит текущие поля формы. Затем описание можно исправить перед сохранением.',
    apply: 'Применить AI-описание к форме',
    applied: 'Описание перенесено в форму. Проверьте и сохраните вещь.',
    multiple:
      'На фото несколько вещей. Загрузите каждый предмет отдельно или заполните описание вручную.',
    notFound:
      'На фото не удалось найти предмет одежды. Выберите другое фото или заполните описание вручную.',
    estimate: 'Примерно {min}…{max} °C. Это оценка, а не гарантия комфорта.',
    budget: 'Бюджет {month} (UTC): учтено {spent} из {limit}. В резерве {reserved}.',
  },
);
