# Вход Google и личное облако Kepler Plan

Kepler Plan использует Firebase Authentication для входа Google и Cloud
Firestore для проектов. Данные привязаны к `Firebase Auth UID`: пользователь
видит свои проекты с любого устройства после входа в тот же Google-аккаунт.

Это личное облако приложения, а не видимая папка Google Drive. Конфигурация
Firebase Web App (`apiKey`, `authDomain`, `projectId`, `appId`) публичная по
замыслу Firebase и может находиться во frontend. **OAuth client secret, ключ
service account и приватные ключи в репозиторий добавлять нельзя.** Доступ к
данным защищают правила из `firestore.rules`.

## 1. Создать проект Firebase

1. Откройте <https://console.firebase.google.com/> и нажмите **Create a
   project**.
2. Выберите понятное имя, например `kepler-plan`.
3. Analytics для работы входа и хранения не обязателен.
4. В **Project settings → General → Your apps** добавьте **Web app**.
5. Скопируйте объект `firebaseConfig`. Он понадобится в шаге 5.

На начальном этапе достаточно бесплатного плана Spark и его квот. Если позже
будет подключён Blaze, настройте бюджетные уведомления: они предупреждают о
расходах, но сами по себе не останавливают списания.

## 2. Включить вход Google

1. Откройте **Build → Authentication → Get started**.
2. В **Sign-in method** включите провайдер **Google**.
3. Выберите email поддержки проекта и сохраните.
4. В **Authentication → Settings → Authorized domains** добавьте:

   ```text
   temirlan2994.github.io
   ```

   Домен вводится без `https://` и без пути репозитория. Для локальной
   разработки можно оставить `localhost`.

## 3. Создать Firestore

1. Откройте **Build → Firestore Database → Create database**.
2. Выберите **Native mode** и production mode.
3. Регион выбирается один раз и затем не меняется. Для пользователей в Европе
   разумно выбрать ближайший европейский регион или multi-region `eur3`, если
   он доступен в выбранном проекте.

Не используйте открытые тестовые правила. Клиентское приложение не содержит
секрет, поэтому только Firestore Rules отделяют данные разных аккаунтов.

## 4. Установить правила доступа

В корне репозитория уже лежат `firebase.json` и `firestore.rules`. Правила:

- разрешают `data/users/<uid>/...` только этому `uid`;
- полностью закрывают глобальные публикации в Firebase: Google-облако
  хранит только личные проекты пользователя;
- ограничивают размер chunk-документов и число сохраняемых версий;
- по умолчанию запрещают все остальные пути.

Установите Firebase CLI и примените правила:

```bash
npm install -g firebase-tools
firebase login
firebase use --add YOUR_FIREBASE_PROJECT_ID
firebase deploy --only firestore:rules
```

Команду `firebase use --add` достаточно выполнить один раз на рабочем
компьютере. Созданный `.firebaserc` содержит только ID проекта, но перед
добавлением в репозиторий всё равно проверьте его содержимое.

Публикация сайта через GitHub Pages **не применяет правила Firestore**.
После каждого изменения `firestore.rules` их нужно отдельно опубликовать
кнопкой **Publish** во вкладке Firestore Database → Rules либо командой выше.

## 5. Подключить Web App к Kepler

Откройте `kepler/firebase-config.js` и перенесите туда значения из
`firebaseConfig`, выданного Firebase Console. Итоговый объект должен содержать
как минимум:

```js
export const FIREBASE_CONFIG = {
  apiKey: '...',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  appId: '...'
};
```

Если файл содержит дополнительные публичные поля (`storageBucket`,
`messagingSenderId`), их можно оставить. Не добавляйте `clientSecret` или
service-account JSON.

После коммита в ветку `claude/awesome-gates-znrtlm` существующий GitHub
Actions workflow опубликует сайт на:

<https://temirlan2994.github.io/zamer-cad-releases/>

## 6. Проверить изоляцию аккаунтов

1. Войдите первым Google-аккаунтом, создайте проект и дождитесь статуса
   сохранения в облаке.
2. Откройте сайт в другом браузере или профиле и войдите тем же аккаунтом —
   проект должен появиться в «Мои проекты».
3. Выйдите и войдите вторым Google-аккаунтом — проекты первого аккаунта не
   должны отображаться.
4. Проверьте ручную версию, фоновый черновик, открытие проекта и удаление.
5. В Firestore Console убедитесь, что проекты находятся под разными путями
   `data/users/<uid>/...`.

Для проверки правил до production полезен Firebase Emulator Suite:

```bash
firebase emulators:start --only firestore
```

## App Check и контроль расходов

После того как обычный вход и сохранение проверены:

1. Зарегистрируйте Web App в **App Check**.
2. Для сайта на GitHub Pages используйте поддерживаемого Firebase Web
   provider (обычно reCAPTCHA Enterprise).
3. Сначала наблюдайте метрики без enforcement, затем включайте enforcement
   для Firestore. Если включить его раньше, чем клиент начнёт отправлять App
   Check token, сохранение перестанет работать.
4. В Google Cloud Console создайте бюджет и email-уведомления, а в Firebase
   Console следите за Firestore reads/writes/storage и Authentication usage.
5. Бюджетное уведомление не является жёстким лимитом. Для защиты дополнительно
   используйте Firestore Rules, App Check и квоты API.

## Типовые ошибки

- `auth/unauthorized-domain` — домен `temirlan2994.github.io` не добавлен в
  Authorized domains.
- `permission-denied` / `Missing or insufficient permissions` — правила не
  опубликованы, устарели либо пользователь вошёл под другим UID. Пока ошибка
  не исправлена, не очищайте данные браузера: локальный черновик можно
  продолжить и синхронизировать после публикации правил.
- Окно Google не открылось — браузер блокирует popup; разрешите всплывающее
  окно для сайта и повторите вход.
- Проект виден только на одном устройстве — проверьте статус облачной
  синхронизации и что на обоих устройствах выбран один Google-аккаунт.
