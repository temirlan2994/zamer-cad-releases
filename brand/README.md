# Логотип Zamer CAD

Складной метр, сложенный в букву Z. Z — первая буква названия, метр — замер,
сетка чертежа на фоне — CAD. Презентация: [zamer-cad-brand.png](zamer-cad-brand.png).
Копия комплекта лежит в [папке на Google Диске](https://drive.google.com/drive/folders/11lz-910awcqZFyxR3eV6ebc779aa9-Dn).

## Файлы

| Файл | Где использовать |
|---|---|
| `svg/zamer-cad-logo.svg`, `png/zamer-cad-logo.png` | Логотип на светлом фоне: сайт, документы, PDF |
| `svg/zamer-cad-logo-dark.svg`, `png/zamer-cad-logo-dark.png` | Логотип на тёмном фоне |
| `png/play-store-icon-512.png` | Значок в Google Play: 512×512, 32-bit PNG, углы скругляет сам магазин. Он же — запасная иконка Android |
| `svg/zamer-cad-icon.svg`, `png/zamer-cad-icon-1024.png`, `png/zamer-cad-icon-512.png` | Значок со скруглёнными углами: соцсети, презентации |
| `svg/zamer-cad-icon-square.svg`, `png/icon-192.png`, `png/apple-touch-icon-180.png` | Квадратный значок: веб-манифест, iPhone |
| `svg/zamer-cad-icon-small.svg`, `png/favicon-48.png`, `png/favicon-32.png`, `png/favicon-16.png` | Упрощённый значок без делений для размеров 48 px и меньше |
| `png/android/ic_launcher_*.png`, `svg/android-*.svg` | Слои адаптивной иконки Android (432 px): фон, метр и монохромный слой для тематических иконок Android 13+ |
| `svg/zamer-cad-mark-navy.svg`, `-white.svg`, `-yellow.svg` | Одноцветная Z: печати, гравировка, водяные знаки |

Текст в логотипе переведён в кривые, шрифт не нужен.

## Цвета

| Цвет | HEX |
|---|---|
| Чертёжный тёмно-синий (фон значка) | `#0F1D38` |
| Жёлтый метр (главные кнопки на сайте) | `#FFC72C` |
| Синий CAD (ссылки и акценты на сайте) | `#1F75FF` |
| Белый | `#FFFFFF` |

Шрифт надписи — Inter Display Black (лицензия SIL OFL).

## Правила

- Вокруг логотипа оставляйте свободное поле не меньше высоты бирки «CAD».
- Логотип не меньше 24 px по высоте. Значок меньше 48 px — только упрощённая версия.
- Не перекрашивайте метр, не поворачивайте и не растягивайте знак, не добавляйте свои эффекты и обводки.
- На фото и пёстром фоне используйте значок целиком (с тёмно-синей плашкой) или белую одноцветную Z.

## Иконки в приложении

Иконки веб-версии и Android берутся из этой папки. После замены файлов
выполните в `prototype/`:

```bash
npm run icons
```

Команда копирует файлы как есть, без перерисовки: в `prototype/icons/` и в
ресурсы Android (`drawable/app_icon.png` и слои `mipmap-xxxhdpi/ic_launcher_*.png`).

## Как пересобрать

Исходники знака — в `source/`. Нужны `pip install fonttools uharfbuzz`, Playwright и
шрифт Inter Display.

```bash
python3 brand/source/build.py brand/svg
```

```bash
node brand/source/raster.js brand/svg brand/png
```
