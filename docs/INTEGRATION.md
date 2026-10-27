# HTTP-контракт и подключение к backend Вани

Этот документ описывает **существующий локальный API**, затем отдельным разделом — необходимые изменения. Предлагаемые production-точки не считаются уже реализованными.

## Текущий пользовательский API

Маршруты определены в `src/server.js`, браузер обращается к ним из `public/portal.js`. Цены/лимит импортируются сервером из `public/portal-model.js`.

| Метод и адрес | Текущее поведение |
| --- | --- |
| `GET /api/portal/session` | Либо demo-сессия из preview-cookie/SQLite, либо подтверждённый OIDC-аккаунт с production-заглушкой. |
| `POST /api/portal/logout` | Удаление настоящей OIDC-сессии; JSON-тело `{}`. |
| `GET /auth/telegram/start` | Начало OIDC, если настроен; иначе редирект в `/account?login=unavailable`. |
| `GET /auth/telegram/callback` | Проверка OIDC и редирект в `/account`; при отказе — `?login=failed`. |
| `POST /api/portal/demo/activate` | Тестовая подписка по `planId`; деньги и панель не затрагиваются. |
| `POST /api/portal/demo/receipt` | Загрузка тестового чека; создаёт pending-заявку, не доступ. |
| `POST /api/portal/demo/scenario` | Демонстрация короткого/длинного срока, `devices-full`, `duplicate-phones`, `expired`. |
| `POST /api/portal/demo/logout` | Сброс demo-аккаунта/подписки; история чеков и owner сохраняются. |

`/api/portal/demo/*` существуют для предпросмотра. В non-demo портал закрывает их до подключения backend; загрузка файла из настоящей OIDC-сессии в demo-процессе также запрещена.

### Модель сессии

Пример формы ответа демо (значения иллюстративные):

```json
{
  "preview": true,
  "source": "demo",
  "account": {
    "id": "demo-account-id",
    "telegram": {"id": "0", "name": "Демо-пользователь", "username": "colors_preview"}
  },
  "subscription": {
    "status": "ACTIVE",
    "planId": "m3",
    "expiresAt": "2027-01-27T12:00:00.000Z",
    "deviceLimit": 3,
    "devicesUsed": 2,
    "devices": [
      {"name": "iPhone", "platform": "iOS · Incy", "type": "phone", "registered": true},
      {"name": "Телефон Android", "platform": "Android · Incy", "type": "phone", "registered": true}
    ],
    "subscriptionUrl": "https://demo.invalid/colors/personal-subscription",
    "syncedAt": "2026-10-27T12:00:00.000Z"
  },
  "payment": null,
  "paymentDetails": {"bank": "", "recipient": "", "requisites": "", "note": "", "ready": false},
  "paymentReady": false,
  "authReady": false
}
```

Без подписки/аккаунта соответствующее поле — `null`. Неизвестные `devicesUsed`/`deviceLimit` — `null`, а не 0. UI считает дублями только распознанные одинаковые типы; общий Android без модели может остаться неопределённым.

Для настоящего OIDC-аккаунта сейчас возвращаются `preview:false`, `source:"backend"`, подтверждённый `account`, **`subscription:null`, `payment:null`, `paymentReady:false`, `subscriptionReady:false`**. Вызова Remnawave ещё нет.

### Как отправляется чек

Это **сырой бинарный body, не multipart/FormData**:

```http
POST /api/portal/demo/receipt
Content-Type: image/png
X-Receipt-Name: <encodeURIComponent(file.name)>
X-Plan-Id: m3
X-Price-Quote: 550
```

В body — файл. Сервер проверяет допустимый MIME и сигнатуру JPG/PNG/WebP/PDF, максимум 10 МБ, актуальную сумму и тариф. Одна pending-заявка на owner. Сумма из заголовка не становится ценой: сравнивается с серверным тарифом. После записи в БД возвращается `{ok:true, preview:true, payment:...}`.

Публичные метаданные заявки: `id`, `customer`, `plan` (снимок `id/months/title/price/deviceLimit/currency`), `fileName`, `mime`, `status`, `createdAt`, `reviewedAt`, `reason`. BLOB и hash owner в ответ пользователю не попадают. Состояния — `review`, `approved`, `rejected`. Статус обновляется кнопкой либо опросом раз в 10 секунд во время ожидания.

## Текущая админка

В **demo** маршруты доступны локально без bearer-токена. В **non-demo** административные `/api/*` вне пользовательского `/api/portal/*` требуют `Authorization: Bearer ADMIN_TOKEN`; `GET /api/public` намеренно остаётся публичным. Основные receipt-действия всё равно закрыты как неготовые production-функции.

| Метод и адрес | Назначение |
| --- | --- |
| `GET /api/state` | Старые тестовые заказы, аудит и новые `portalReceipts`, `manualPayment`. |
| `POST /api/portal-payment-settings` | JSON `bank`, `recipient`, `requisites`, `note` — строки до 1000 символов. |
| `GET /api/portal-receipts/:id/file` | Скачать demo-чек как `application/octet-stream` с `Content-Disposition: attachment`. |
| `POST /api/portal-receipt-review` | JSON `{id, action:"approve"|"reject", reason}`. Для отказа причина обязательна. |

Demo approve продлевает от более поздней даты — сейчас или конец активной подписки — и создаёт фиктивный URL. Повторное решение отвергается, повторного продления нет. Это не подтверждение реального банковского поступления и не изменение VPN-панели.

Старые `/api/order`, `/api/demo-pay`, `/api/approve`, `/api/issue` и другие маршруты принадлежат первоначальному Stars-прототипу. Их очередь не является общей production-очередью сайта и действующего бота.

## Где хранятся данные в этом прототипе

- `portal_demo_sessions`: preview-сессии и тестовые подписки; ключ — hash cookie.
- `portal_receipts`: файлы BLOB, снимки тарифов и решения.
- `meta.manual_payment_details`: реквизиты, сохранённые через админку.
- `web_oauth_attempts`, `web_login_sessions`: попытки OIDC и хеши настоящих web-сессий.
- `users`, `orders`, `subscriptions`, `outbox`, `payment_incidents`: первоначальный бот-прототип.
- `audit`: события прототипов. Текущая web-личность администратора отдельно не устанавливается.

Preview-cookie живёт 7 дней. Он не является customer ID для production. Настоящий OIDC хранит подтверждённый Telegram ID; связи с клиентом/подпиской Remnawave ещё нет.

## Предлагаемая интеграция — ещё предстоит реализовать

```text
Обычный браузер ── Telegram OIDC ──┐
                                ├─ проверенный customer ID в backend Вани
Telegram Mini App ─ initData ────┘             │
                            общие заказы и ручная проверка
                                              │
                             сохранённый Remnawave user ID
                                              │
                                серверное чтение / выдача
```

1. Оставить один backend источником клиентов, заказов и решений. Привязать сайт к действующему боту по подтверждённому числовому Telegram ID. Username — только отображаемое поле.
2. Заменить production-ветку `GET /api/portal/session` реальными данными. Можно сохранить DTO и адрес либо согласовать новый API и заменить функцию `api()`/обработчики клиента.
3. Reader `RemnawaveReader({baseUrl,token}).subscriptionFor(panelUserId)` получает сохранённый ID только от backend, не от браузера. Проверяет HTTPS, задаёт timeout 8 секунд и отдаёт ограниченные поля, без паролей/сырых HWID. Адреса текущего адаптера: `/api/users/:id`, `/api/hwid/devices/:id`.
4. Сверить версию панели, тип ID, поля/nullable-значения и границы истечения. Подготовить понятное состояние при недоступной панели, без ложной активации или нулевого счётчика.
5. Перенести заявки на проверку и файлы в общую систему backend. Установить настоящий owner из проверенной сессии и роль администратора на каждом действии; ID запроса сам по себе не даёт доступ к чеку.
6. Разделить банковское подтверждение, ручное одобрение выдачи и успешное применение в панели. Сохранять транзакционное решение, единственную задачу на заказ и результат; при сбое панели повторять выдачу без повторного платежа/продления.
7. Для Mini App добавить проверку подписи сырого `initData` и свежести `auth_date`, затем создавать того же клиента. Нельзя доверять `initDataUnsafe`, username или Telegram ID из произвольного JSON.
8. OIDC `openid profile` сам по себе не разрешает уведомления. Отдельно учитывать разрешение на сообщения/доступный чат бота.
9. Проверить схему самостоятельной оплаты и сценарий внутри Telegram; выбранный UI перевода не отменяет правил платформы для цифровых услуг.
10. Проверить миграцию существующих клиентов без создания дубликатов и сохранение текущих сроков/индивидуальных лимитов. Базовый лимит 3 не должен молча переписывать уже согласованные условия.

Тесты для нового подключения: существующий клиент, новый клиент, отсутствующая подписка, истёкший доступ, неизвестный HWID, два телефона, три разных типа, upload/reject/retry, двойное одобрение, недоступная панель, повтор фоновой задачи, вход из браузера и Mini App в один аккаунт.
