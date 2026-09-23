# Миграция на Firebase-проект `siberia-777`

Ветка: `siberia-777-migration`. В `main` ничего не менялось — рабочий сайт не затронут.

## Что уже готово
- Конфиг Firebase в `index.html` переключён на `siberia-777` (ветка, не задеплоено).
  Поля `messagingSenderId` и `appId` пустые — их нужно вставить из консоли.
- Скрипт переноса данных `tools/migrate-to-siberia777.mjs`.
- Полный бэкап данных и релиз: `backups/2026-09-11_pre-siberia777/`, git-тег `pre-siberia777`.

## Шаги

### 1. Подготовить проект `siberia-777` (Firebase Console)
1. Authentication → Sign-in method → включить **Email/Password**, создать пользователя.
2. Firestore → создать базу, если ещё нет.
3. Firestore → Rules:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /siberia_tracker/{doc} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```
4. Project settings → Your apps → Web app → скопировать `messagingSenderId` и `appId`
   в `index.html` (блок `firebaseConfig`, строки ~1159).

### 2. Перенести данные (читает `ihome-app777`, пишет `siberia-777`)
Только проверка, ничего не пишет:
```
node tools/migrate-to-siberia777.mjs --dry-run
```
Реальный перенос. Если правила требуют вход — передайте пользователя проекта:
```
SIBERIA_EMAIL=user@example.com SIBERIA_PASSWORD=секрет \
  node tools/migrate-to-siberia777.mjs
```
Скрипт не удаляет данные источника и не трогает поля, которых нет в источнике.

### 3. Проверка
- `node tools/migrate-to-siberia777.mjs --dry-run` должен показать: tasks 215 живых,
  sprints 5, mytasks 15, notes 2, hours_features 1, estimates 2.
- Локально: `python3 -m http.server 8080`, открыть `http://localhost:8080/`,
  войти пользователем `siberia-777` и убедиться, что задачи/спринты/заметки на месте.
- В приложении кнопка «🔎 Проверить: Firestore vs localStorage» должна показать совпадение.

### 4. Выкатить
После успешной проверки смержить `siberia-777-migration` в `main` — тогда обновится
GitHub Pages. Откат: `git checkout main && git revert ...` либо тег `pre-siberia777`.
