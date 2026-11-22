// Публичная конфигурация Firebase Web App.
//
// Эти значения НЕ являются секретами: браузер всё равно получает их при
// запуске. Доступ к проектам защищают Firebase Authentication и правила
// Firestore. Никогда не добавляйте сюда OAuth client secret или service key.
//
// После создания Firebase Web App замените пустые строки значениями из
// Firebase Console → Project settings → Your apps → SDK setup and config.

export const FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyATxpNXc30buiGU4w2wrADr_PNvNsSE1uk',
  authDomain: 'kepler-plan.firebaseapp.com',
  projectId: 'kepler-plan',
  storageBucket: 'kepler-plan.firebasestorage.app',
  messagingSenderId: '245223238557',
  appId: '1:245223238557:web:d5a78d71ba3ac5efffdd74',
});

export function firebaseConfigured(config = FIREBASE_CONFIG) {
  return ['apiKey', 'authDomain', 'projectId', 'appId']
    .every((key) => typeof config?.[key] === 'string' && config[key].trim().length > 0);
}
