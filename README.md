# Company Parser

MVP-система парсинга компаний из Google Maps, Instagram и открытых сайтов на Node.js 20+, TypeScript, MongoDB, BullMQ, Redis и Puppeteer.

## Быстрый запуск

```bash
cp .env.example .env
docker compose up -d
npm install
npm run typecheck
npm run worker
```

В отдельном терминале:

```bash
npm run admin
```

Открой `http://localhost:3000` и поставь задачу Google Maps с нужными параметрами: например `кофейня` + `Kyiv, Ukraine` или `фастфуд` + `Lviv, Ukraine`.

В админке можно очистить очередь кнопкой `Clear queue`. Лимит компаний на один keyword задается переменной `GOOGLE_MAPS_MAX_RESULTS` в `.env`.

Workflow контактов:

```text
Google Maps list -> Google Maps place details -> phone/website -> website/contact pages -> email -> MongoDB -> CSV
```

Если в базе уже есть компании с сайтами, нажми `Enrich saved websites` в админке. Worker поставит отдельную задачу по сайтам без email.

Если данные были собраны старой версией без phone/website, нажми `Clear companies` в админке и запусти поиск заново. Новая версия открывает каждую карточку Google Maps и достает детали.

Компания сохраняется в MongoDB, только если найден хотя бы один контакт: `phone`, `email` или `instagram`. `website` используется для добора email, но сам по себе не считается контактом для CRM-экспорта.

Телефоны нормализуются для Украины в E.164. Примеры: `0999999999`, `999999999`, `38999999999`, `+38999999999` -> `+380999999999`. Слишком короткие или неполные номера отбрасываются.

Большие сети заведений можно отсеивать через `.env`:

```env
EXCLUDE_CHAINS=true
CHAIN_MAX_SAME_NAME_PER_JOB=2
CHAIN_DENYLIST=kfc,mcdonald,пузата хата,burger king,starbucks
```

Фильтр удаляет бренды из denylist и заведения, чье нормализованное имя повторилось в одном job больше `CHAIN_MAX_SAME_NAME_PER_JOB` раз.

Нерелевантные категории можно отсеивать так:

```env
EXCLUDED_CATEGORIES=shopping mall,mall,shopping center,hotel,supermarket,grocery store,gas station,food court,трц,тц,торговий центр,торговый центр
```

Если Google Maps не дал сайт, worker может попробовать найти его через Google Search:

```env
GOOGLE_SEARCH_ENRICH_MISSING_WEBSITES=true
GOOGLE_SEARCH_MAX_COMPANIES=40
GOOGLE_SEARCH_RESULTS_PER_COMPANY=10
```

Для дедупликации сохраняется `websiteDomain`, поэтому `https://site.ua`, `https://www.site.ua` и страницы вроде `/contacts` считаются одним доменом.

В CSV также сохраняется `googleMapsUrl` - ссылка на карточку заведения в Google Maps.

Для большего покрытия задавай несколько keywords через запятую или с новой строки: `coffee shop`, `cafe`, `bakery`, `restaurant`, `fast food`, `burger`, `pizza`, `kebab`.

Одноразовая постановка дефолтных задач без админки:

```bash
npm run enqueue
```

Экспорт валидных компаний:

```bash
npm run export:csv
```

Валидные компании здесь - это записи, где есть хотя бы один контакт: телефон, email или Instagram.

Экспорт сырых данных без email-валидации:

```bash
npm run export:raw
npm run export:all
```

CSV будет создан в `output/companies.csv`.
Raw CSV будет создан в `output/companies-raw.csv`, all CSV - в `output/companies-all.csv`.

## Важное

Google Maps и Instagram активно меняют верстку и ограничивают автоматизацию. Парсеры реализованы с несколькими селекторами, лимитами, задержками и ретраями, но для продакшена нужны прокси, мониторинг блокировок и юридическая проверка условий использования источников.
