# SIBERIA — трекер задач (Jira-like)

Один большой файл с функционалом: задачи, спринты, заметки, бэкапы, sync с Firebase.
Проект на русском языке, весь UI — русский. Комментарии и описания коммитов желательны на русском.

## 👉 Начало работы (главное)

- **Единственный рабочий файл: корневой `index.html`** (~5000 строк, ~250 КБ). Весь код трекера + дашборда здесь. Номера строк в этом файле быстро устаревают — ищите функции по имени.
- Задеплой на **GitHub Pages** из корня репозитория (`.github/workflows/deploy.yml`, `path: .`) — публикуется корневой `index.html`. Тем же workflow после Pages идёт **выгрузка на reg.ru по FTP** (секреты `FTP_HOST/FTP_USER/FTP_PASS/FTP_PORT/FTP_DIR`). Workflow срабатывает на push в `main` и вручную (`workflow_dispatch`), поэтому правки в других ветках на сайт не попадают.
- Проверка локально: открыть по `http(s)`, а не `file://` (Firebase Auth требует http(s)): `python3 -m http.server 8080` → `http://localhost:8080/`.
- Логотип: `turkish-angora_141876.png` (в корне, рядом с `index.html`).
- Файлы `tracker.html`, `jira-tracker/`, `siberia-app/` **удалены** — устаревшие копии без дашборда. Не создавайте их заново.

## 📂 Структура

| Путь | Что это |
|------|---------|
| `index.html` | **Единственный рабочий файл** — трекер, заметки, часы, оценки, дашборд |
| `.github/workflows/deploy.yml` | Деплой: GitHub Pages из корня + FTP на reg.ru |
| `tools/migrate-to-siberia777.mjs` | Перенос данных `ihome-app777` → `siberia-777` (`--dry-run` поддерживается) |
| `tools/migrate-to-siberia777.md` | Инструкция по миграции Firebase-проекта |
| `tools/undelete-task.mjs` | «Воскрешение» задачи по id: снимает `deleted`, ставит свежий `updatedAt` |
| `backups/` | Локальные снимки данных. **В git не попадают** (`.gitignore`), существуют только на этой машине |
| `SIBERIA_README.md` | Старая документация функционала (устарела, см. ниже) |

⚠️ **`SIBERIA_README.md` устарел**: в нём нет авторизации и не описаны дашборд, «Часы по фичам», «Проектная оценка», типы/классы задач. Firebase-проект в README (`siberia-777`) совпадает с текущим кодом **только на ветке миграции** (см. ниже).

## 🔥 Firebase и данные (из кода)

Конфиг в блоке `firebaseConfig` в `index.html`:

| | Ветка `siberia-777-migration` (текущая) | `main` (задеплоен сейчас) |
|---|---|---|
| projectId | `siberia-777` | `ihome-app777` |
| authDomain | `siberia-777.firebaseapp.com` | `ihome-app777.firebaseapp.com` |

- Коллекция Firestore у обоих проектов одна: **`siberia_tracker`** (`FB_COLL`).
- **Есть авторизация** Email/Password: `login()` / `register()` / `currentUser` / `onAuthStateChanged`. Без входа приложение не стартует (`onAuthStateChanged` вызывает `init()`). `firebase.initializeApp()` выполняется ДО подписки (иначе «No Firebase App»).
- **Firestore — единый источник правды**:
  - Реалтайм-синк через `onSnapshot` по документам `tasks`, `sprints`, `mytasks`, `notes`, `hours_features`, `estimates`.
  - В каждом документе данные лежат в поле `items` — **карта `id → элемент`** (старый формат «массив» ещё читается, миграция делает `migrateDocToMap` / `ensureItemsMaps`).
  - Merge по `updatedAt` на каждый элемент (union по id, побеждает больший `updatedAt`); удаление — tombstone-поле `deleted`. Для `mytasks` элемент — просто строка-id, набор записывается целиком.
  - localStorage — только оффлайн-кэш: `tracker_tasks`, `tracker_sprints`, `tracker_mytasks`, `tracker_notes`, `tracker_hours_features`, `tracker_estimates`, `tracker_projects`.
  - Бэкапы — в localStorage `siberia_backups` (хранятся 3 последних, `autoBackup()` спрашивает не чаще раза в час). В снимок входят `tasks`, `sprints`, `myTasks`, `notes`, `hoursFeatures`; **`estimates` в снимок не попадают** и при восстановлении не возвращаются.
- **Миграция на `siberia-777`**: ветка `siberia-777-migration` (в `main` пока `ihome-app777`). Полный снимок до миграции: тег `pre-siberia777` и локальная папка `backups/2026-09-11_pre-siberia777/`. Пока ветка не в `main`, задеплоен старый проект — агенту нужно писать в тот проект, откуда открыт сайт.

## 🤖 AI Tracker (поле задачи для агента)

- Задачи могут содержать поле **`aiTracker`** (строка) — ссылка-связка с задачей в другом трекере. Заполняет агент (OpenClaw).
- Формат значения: ссылка `https://...` либо текст со ссылкой внутри (например `JIRA-123 https://...`). В UI ссылка делается кликабельной.
- Смотреть поле: карточка задачи (`openDetail`) — поле «AI Tracker»; редактировать вручную: `openTaskModal` → `taskAiTracker`.
- **Как писать агенту**: элемент задачи лежит в Firestore, коллекция `siberia_tracker`, документ `tasks`, в `items` (карта `id → задача`). Меняйте `aiTracker`, **обязательно поднимая `updatedAt`** (`Date.now()`), иначе merge по `updatedAt` отбросит правку. Остальные поля задачи при записи нужно сохранять — элемент хранится целиком. Писать в тот проект, который использует деплой (`main` → `ihome-app777`, ветка миграции → `siberia-777`).

## 🔧 Архитектура кода (index.html)

Одностраничный HTML: `<style>` → `<script>`. Всё в глобальных функциях, без модулей/фреймворков. Верхние разделы переключаются функциями `showDashboard` / `showHoursView` / `showEstimatesView` / `showTasksView`, текущий раздел и открытая задача отражаются в хэше (`syncSectionHash`, `#task=<id>`).

- **Данные**: глобальные `tasks`, `sprints`, `myTasks`, `notes`, `hoursFeatures`, `estimates`, `PROJECTS` (`tracker_projects`).
- **Константы**: `STATUSES`, `PRIORITIES`, `TYPES`, `SIZES` (+`SIZE_ORDER`), `TASK_CLASSES`, `STATUS_ORDER`, `PRIO_ORDER`, `TASK_CLASS_ORDER` и `*_CLASSES` для бейджей.
- **Ключевые функции**:
  - Рендер: `renderTasks`, `renderSprints`, `renderNotes`, `renderFunnel`, `renderHours`, `renderEstimates`, `renderDashboard`.
  - CRUD задач: `openTaskModal`, `saveTask`, `deleteTask`, `openDetail` (карточка задачи), `editFromDetail`.
  - CRUD спринтов: `openSprintModal`, `saveSprint`, `startSprint`, `completeSprint`.
  - Фильтры/сортировка: `filterBySprint`, `filterMyTasks`, `showUrgentView`, `setSort`, `sortCompare`, `resetFilters`, `refreshProjectFilter`.
  - Массовые операции: `moveSelectedTasks`, `updateMassActions`, `clearSelection`.
  - Drag-and-drop: `handleDragStart`/`handleDropOn*` для задач; `noteDragStart`/`noteDrop*` для заметок.
  - **Sync (Firestore-first)**: `loadFromFirebase` (onSnapshot-подписки), `applyItemsSnapshot`/`commitItems` (элементы, merge по `updatedAt`), `applyNotesSnapshot`/`commitNotes` (заметки), `saveData`, `sanitizeForFirestore`, `autoBackup`, `saveDataToFile`, `loadDataFromFile`, `restoreBackup`.
  - Дашборд: `renderDashboard`, `getDashboardRange`, `dashboardTasks`, `calcMTTR_P1`, `calcLeadTimeP2`, `calcThroughput`, `renderSizeBreakdown`.
  - AI: `renderAiTracker` — рендер ссылки поля `aiTracker` в карточке.
  - **Часы по фичам**: `HF_STAGES` — лестница этапов сценария (Не начат → Аналитика → Бэк → Фронт → QA → Готово), `hfScenarioStats`, `hfScenarioList`. Порядок сценариев внутри фичи задаёт `hoursScenarioSort` (localStorage `tracker_hours_scenario_sort`): `stage` — по этапу, незавершённые сверху (по умолчанию); `stage-rev` — готовые сверху; `weight` — по весу (большие сверху); `added` — как добавлены. Сортирует `hfScenarioOrder` (он же отдаёт настоящие индексы в `f.steps` для edit/remove), переключатель — селект `#hoursScenarioSort` (`onHoursScenarioSortChange`).

## 🎨 Внешние зависимости (CDN)

Firebase SDK v10 compat (gstatic): `firebase-app-compat`, `firebase-firestore-compat`, `firebase-auth-compat`.
Шрифты: Google Fonts (Inter, Roboto).

## ⚙️ Статусы / приоритеты / типы / классы

- **Статусы** (10): `Бэклог / Новая / На уточнении / Аналитика / В работе / QA / Ревью / Требуется релиз / Готово / Отменена`.
- **Порядок статусов** (`STATUS_ORDER`): `Требуется релиз`→-1, `Бэклог`→0, `Готово`→7, `Отменена`→8.
- **Приоритеты** (5): Критичный / Высокий / Средний / Низкий / Очень низкий.
- **Типы** (4): Баг / Фича / Обновление / Рутина.
- **Размеры**: S / M / L / XL / XXL.
- **Классы задач**: `P1 · Expedite` / `P2 · Standard` / `P3 · Fixed Date`.

## ✅ Перед внесением правок

1. Править **только корневой `index.html`** — единственный рабочий файл и источник правды.
2. Проверять в браузере через `http://localhost:8080/` (нужен вход через Firebase). `file://` не работает.
3. Git-репозиторий: корень проекта, `.git` в скрытой папке. Работать из `/Users/ekaterinaartamonova/Projects/SIBERIA`.
