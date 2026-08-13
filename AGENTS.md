# SIBERIA — трекер задач (Jira-like)

Один большой файл с функционалом: задачи, спринты, заметки, бэкапы, sync с Firebase.
Проект на русском языке, весь UI — русский. Комментарии и описания коммитов желательны на русском.

## 👉 Начало работы (главное)

- **Единственный рабочий файл: корневой `index.html`** (≈2700 строк, ~130 КБ). Весь код трекера + дашборда здесь.
- Задеплой на **GitHub Pages** из корня репозитория (см. `.github/workflows/deploy.yml`, `path: .`) — на сайте открывается корневой `index.html`. Любые правки в других файлах на сайт НЕ попадают.
- Проверка локально: открыть `index.html` по `http://localhost` (требуется http(s)-источник для Firebase Auth), например `python3 -m http.server 8080` и открыть `http://localhost:8080/`.
- Логотип: `turkish-angora_141876.png` (в корне, рядом с index.html).
- Файлы `tracker.html`, `jira-tracker/`, `siberia-app/` **удалены** — это были устаревшие копии без дашборда. Не создавайте их заново.

## 📂 Структура

| Путь | Что это |
|------|---------|
| `index.html` | **Единственный рабочий файл** — трекер + дашборд (единственный источник) |
| `.github/workflows/deploy.yml` | Деплой на GitHub Pages (public: весь корень, т.е. index.html) |
| `turkish-angora_141876.png` | Логотип |
| `SIBERIA_README.md` | Старая документация функционала (частично устарела!) |

⚠️ **`SIBERIA_README.md` частично устарел**: в нём Firebase-проект `siberia-777` и нет авторизации.
В реальном коде (`index.html`) — проект `ihome-app777` и есть вход.

## 🔥 Реальный Firebase и данные (из кода)

`index.html` (строки ~680–820):
- **Firebase-проект: `ihome-app777`**
  - apiKey: `AIzaSyBRYeMKAJxLQf5B6ZzkCggTlb1ZUf_o75o`
  - authDomain: `ihome-app777.firebaseapp.com`
  - projectId: `ihome-app777`
- **Есть авторизация**: `login()` / `register()` / `currentUser`. Без входа приложение не стартует (`init()` проверяет `currentUser`). `firebase.initializeApp()` выполняется ДО `onAuthStateChanged` (иначе ошибка «No Firebase App»).
- Коллекция Firestore: `siberia_tracker` (`FB_COLL`).
- **Firestore — единый источник правды** (после рефакторинга, авг 2026):
  - Реалтайм-синк через `onSnapshot` (по `tasks`, `sprints`, `mytasks`, `notes`).
  - Merge по `updatedAt` на каждый элемент (union по id, побеждает больший `updatedAt`); локальные метания tombstone (`deleted`) для удаления.
  - localStorage — только оффлайн-кэш (`tracker_tasks`, `tracker_sprints`, `tracker_mytasks`, `tracker_notes`; заметки-вкладки: `tracker_notes`, могилки: `tracker_notes_deleted`).
  - Бэкапы: `siberia_backups` (хранятся 3 последних).

## 🔧 Архитектура кода (index.html)

Одностраничный HTML: `<style>` → `<script>`. Всё в глобальных функциях, без модулей/фреймворков.

- **Данные**: глобальные `tasks`, `sprints`, `myTasks`, `notes` (строки ~1013–1022).
- **Константы** (строки ~690–701): `STATUSES` (8 статусов, включая «Требуется релиз»), `PRIORITIES` (5), `TYPES` (4), `SIZES` (S/M/L/XL/XXL), `TASK_CLASSES` (P1/P2/P3) + `*_CLASSES` для бейджей.
- **Ключевые функции**:
  - Рендер: `renderTasks()` (~1322), `renderSprints()` (~1847), `renderNotes()` (~1497), `renderFunnel()`, `renderDashboard()` (~2616).
  - CRUD задач: `openTaskModal`, `saveTask`, `deleteTask`, `openDetail`.
  - CRUD спринтов: `openSprintModal`, `saveSprint`, `startSprint`, `completeSprint`.
  - Фильтры/сортировка: `filterBySprint`, `filterMyTasks`, `showUrgentView`, `setSort`, `sortCompare`, `resetFilters`.
  - Массовые операции: `moveSelectedTasks`, `updateMassActions`, `clearSelection`.
  - Drag-and-drop: `handleDragStart`/`handleDropOn*` для задач; `noteDragStart`/`noteDrop*` для заметок.
  - **Sync (Firefire-first)**: `loadFromFirebase` (onSnapshot-подписки, ~917), `applyItemsSnapshot`/`commitItems` (merge по updatedAt), `applyNotesSnapshot`/`commitNotes` (заметки), `saveData`, `autoBackup`, `saveDataToFile`, `loadDataFromFile`, `restoreBackup`.
  - Дашборд: `renderDashboard`, `getDashboardRange`, `dashboardTasks`, `calcMTTR_P1`, `calcLeadTimeP2`, `calcThroughput`, `renderSizeBreakdown`.

## 🎨 Внешние зависимости (CDN)

Firebase SDK v10 compat (gstatic): `firebase-app-compat`, `firebase-firestore-compat`, `firebase-auth-compat`.
Шрифты: Google Fonts (Inter, Roboto).

## ⚙️ Статусы / приоритеты / типы

- **Статусы**: `Новая / На уточнении / Аналитика / В работе / QA / Ревью / Требуется релиз / Готово` (8 штук).
- **Порядок статусов** (для сортировки): `Требуется релиз`→-1, `Готово`→6 (см. `STATUS_ORDER`, строка 932).
- **Приоритеты**: Критичный / Высокий / Средний / Низкий / Очень низкий.
- **Типы**: Баг / Фича / Обновление / Рутина.

## ✅ Перед внесением правок

1. Править **только корневой `index.html`** — единственный рабочий файл и источник правды.
2. Чтобы проверить в браузере — открыть `http://localhost:8080/` (нужен вход через Firebase). Firebase требует http(s)-источник, `file://` не работает.
3. Git-репозиторий: корень проекта, .git в скрытой папке. Работать с ним из `/Users/ekaterinaartamonova/Projects/SIBERIA`.
