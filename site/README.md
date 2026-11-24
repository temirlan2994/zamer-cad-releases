# Сайт Zamer CAD

Продающая страница для скачивания APK и покупки подписки:
<https://zamer-cad.netlify.app>. Статические файлы без сборки.

```text
site/
├── netlify.toml        публикуется папка public/
├── public/             сам сайт
│   ├── index.html      тексты, цены, FAQ
│   ├── styles.css
│   ├── app.js          ссылки на оплату, скачивание, окна
│   ├── _redirects      /download → скачивание на телефоне (QR-код)
│   ├── _headers        заголовки безопасности и кэш
│   ├── img/            скриншоты, PDF-лист, иконки, og.png
│   └── media/          ролики инструментов (MP4) и их постеры
└── capture/            пересъёмка скриншотов, роликов и og.png
```

## Цены

Цены записаны в `public/index.html`: карточки тарифов, FAQ «Что будет через
14 дней?» и блок `application/ld+json` в `<head>`. Сейчас: $7 в месяц,
$59 в год (≈ $4,92 в месяц, экономия $25).

## Оплата картой

В начале `public/app.js` заполните ссылки на страницы оплаты:

```js
checkout: {
  month: "https://…",  // Pro на месяц
  year: "https://…",   // Pro на год
},
```

Пока ссылка пустая, кнопка «Купить» открывает окно «Оплата картой — совсем
скоро» с кнопкой бесплатного скачивания.

`public/_headers` не ограничивает скрипты и стили: на бесплатном тарифе Netlify
встраивает обязательный бейдж «Powered by Netlify». Нижняя кнопка «Скачать» на
телефоне поднимается над ним автоматически.

## Скачивание

- Кнопки ведут на последний релиз GitHub: `app.js` читает
  `releases/latest` репозитория `temirlan2994/zamer-cad-releases` и подставляет
  ссылку на `.apk`, версию и размер. Без ответа API остаётся ссылка из HTML.
- На Android файл скачивается сразу и открывается инструкция установки.
  На компьютере показывается QR-код, на iPhone — сообщение, что приложение для Android.
- `https://zamer-cad.netlify.app/download` — короткая ссылка для QR-кода и
  мессенджеров: на Android сразу начинает скачивание.

## Публикация на Netlify

Проект Netlify: `zamer-cad`. Варианты:

1. **Из GitHub (рекомендуется).** Netlify → Project configuration → Build &
   deploy → Link repository → `temirlan2994/zamer-cad-releases`, Base directory
   `site`, ветка `main`. Каждое изменение `site/` в `main` публикуется само.
2. **Вручную.** Netlify → Deploys → перетащите папку `site/public`.
3. **CLI.** Из корня репозитория:
   `npx netlify-cli deploy --dir site/public --prod --site zamer-cad`.

## Новые скриншоты

После заметных изменений интерфейса:

```bash
cd prototype && node server.js
```

```bash
node site/capture/capture.js
```

Ролики вкладки «Инструменты» (линия, полилиния, фигуры, обрезка, зеркало,
размеры) снимаются покадрово в том же прототипе, нужен ffmpeg:

```bash
node site/capture/tools-demo.js
```

Можно переснять отдельные ролики: `node site/capture/tools-demo.js trim mirror`.

`capture.js` импортирует демо-квартиру и перезаписывает `screen-*.webp`. PDF-лист
сохраняется во временную папку, путь печатается в конце; первую страницу
переведите в `img/pdf-sheet.webp` (ширина 1000 px). `capture/og.html` —
шаблон картинки для превью ссылки (`img/og.png`, 1200×630).
