#!/usr/bin/env node
// MCP-сервер для трекера SIBERIA (siberia-777).
//
// Протокол: Model Context Protocol поверх stdio (newline-delimited JSON-RPC 2.0).
// Без внешних зависимостей — нужен только Node.js 18+ (глобальный fetch).
//
// Данные — Firestore, коллекция siberia_tracker, проект siberia-777 (боевой, как у сайта).
// Доступ по Email/Password Firebase Auth через REST.
//
// Запуск (переменные окружения, как у остальных скриптов tools/):
//   SIBERIA_EMAIL=user@example.com SIBERIA_PASSWORD=secret node tools/siberia-mcp.mjs
//
// Как подключить (Cursor / Claude Desktop и т.п.) — см. tools/siberia-mcp.md

import process from 'node:process';

// ---------------------------------------------------------------------------
// Конфиг Firebase (боевой проект siberia-777 — менять ключи нельзя)
// ---------------------------------------------------------------------------
const PROJECT_ID = process.env.SIBERIA_PROJECT || 'siberia-777';
const API_KEY = process.env.SIBERIA_API_KEY || 'AIzaSyB7BMHcSec352z7C7gFmVibVwtMcEtb-XQ';
const COLLECTION = 'siberia_tracker';

// ---------------------------------------------------------------------------
// Справочники (в точности как в index.html)
// ---------------------------------------------------------------------------
const STATUSES = ['Бэклог', 'Новая', 'На уточнении', 'Аналитика', 'В работе', 'QA', 'Ревью', 'Требуется релиз', 'Готово', 'Отменена'];
const PRIORITIES = ['Критичный', 'Высокий', 'Средний', 'Низкий', 'Очень низкий'];
const TYPES = ['Баг', 'Фича', 'Обновление', 'Рутина'];
const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const TASK_CLASSES = ['P1 · Expedite', 'P2 · Standard', 'P3 · Fixed Date'];
const SPRINT_STATUSES = ['pending', 'active', 'completed'];

// Палитра цветов (для эпиков/исполнителей), как в index.html EPIC_COLORS.
const COLORS = ['#F4B8C7', '#B8E0F4', '#C9F4B8', '#F4E3B8', '#E6BFED', '#F0A9A0', '#A6E9ED', '#E3E8FA', '#CECCCB'];

// Поля, которые можно задавать в create_task / update_task (без служебных id/createdAt/updatedAt/deleted).
const TASK_FIELDS = {
  title: 'string', description: 'string', comment: 'string', aiTracker: 'string',
  status: 'string', priority: 'string', type: 'string', taskClass: 'string',
  project: 'string', size: 'string', deadline: 'string',
  sprintId: 'string', epicId: 'string', assigneeId: 'string',
};

// ---------------------------------------------------------------------------
// Firebase REST: токен и конвертеры значений
// ---------------------------------------------------------------------------
let _token = null;

function docUrl(doc) {
  return `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}/${doc}`;
}

async function getToken() {
  const email = process.env.SIBERIA_EMAIL;
  const password = process.env.SIBERIA_PASSWORD;
  if (!email || !password) {
    throw new Error('Нужны переменные окружения SIBERIA_EMAIL и SIBERIA_PASSWORD');
  }
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!res.ok || !data.idToken) throw new Error('Не удалось войти в siberia-777: ' + JSON.stringify(data));
  return data.idToken;
}

async function authHeaders() {
  if (!_token) _token = await getToken();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${_token}` };
}

// Повторяем запрос один раз при 401 (свежий токен), затем бросаем ошибку.
async function apiFetch(url, opts) {
  let headers = await authHeaders();
  let res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    _token = await getToken();
    headers = await authHeaders();
    res = await fetch(url, { ...opts, headers });
  }
  return res;
}

// Firestore REST value -> обычное JS-значение (как в tools/undelete-task.mjs).
function fromRest(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) {
    const out = {};
    const f = (v.mapValue && v.mapValue.fields) || {};
    Object.keys(f).forEach((k) => { out[k] = fromRest(f[k]); });
    return out;
  }
  if ('arrayValue' in v) {
    const vals = (v.arrayValue && v.arrayValue.values) || [];
    return vals.map(fromRest);
  }
  return null;
}

// Обычное JS-значение -> Firestore REST value.
function toRest(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toRest) } };
  if (typeof v === 'object') {
    const fields = {};
    Object.keys(v).forEach((k) => { if (v[k] !== undefined) fields[k] = toRest(v[k]); });
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

// ---------------------------------------------------------------------------
// Работа с items (карта id -> элемент). Поддерживаем и старый формат (массив).
// ---------------------------------------------------------------------------
function itemKey(el) {
  return (el && el.id !== undefined && el.id !== null) ? String(el.id) : String(el);
}
function isTombstone(el) { return !!(el && el.deleted); }

function itemsAsMap(items) {
  const m = {};
  if (Array.isArray(items)) {
    items.forEach((el) => { if (el == null || el === '') return; m[itemKey(el)] = el; });
  } else if (items && typeof items === 'object') {
    Object.keys(items).forEach((k) => {
      const v = items[k];
      if (v == null || v === '') return;
      m[k] = v;
    });
  }
  return m;
}

function liveItems(items) {
  const map = itemsAsMap(items);
  return Object.keys(map).map((k) => map[k]).filter((el) => el && !isTombstone(el));
}

// Следующий числовой id: максимальный среди существующих (устойчив к нечисловым id) + 1.
function nextId(map) {
  let max = 0;
  Object.keys(map).forEach((k) => {
    const el = map[k];
    const n = Number(el && el.id !== undefined && el.id !== null ? el.id : k);
    if (Number.isFinite(n)) max = Math.max(max, n);
  });
  return String(max + 1);
}

// Читает документ и возвращает { map, exists }. map — карта id -> элемент.
async function readItems(doc) {
  const res = await apiFetch(`${docUrl(doc)}?key=${API_KEY}`, { method: 'GET' });
  if (res.status === 404) return { map: {}, exists: false };
  if (!res.ok) throw new Error(`read ${doc}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const f = data.fields && data.fields.items;
  return { map: f ? itemsAsMap(fromRest(f)) : {}, exists: true };
}

// Пишет items целиком (PATCH с updateMask), сохраняя формат карты.
async function writeItems(doc, map, exists) {
  const body = { fields: { items: toRest(map) } };
  const q = exists
    ? 'updateMask.fieldPaths=' + encodeURIComponent('items')
    : 'currentDocument.exists=false';
  const res = await apiFetch(`${docUrl(doc)}?key=${API_KEY}&${q}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`write ${doc}: ${res.status} ${await res.text()}`);
}

// Удобная обёртка: прочитать, изменить карту, записать. mutate получает (map, exists).
async function mutateItems(doc, mutate) {
  const { map, exists } = await readItems(doc);
  const result = await mutate(map, exists);
  await writeItems(doc, map, exists);
  return result;
}

// ---------------------------------------------------------------------------
// MCP stdio-транспорт (newline-delimited JSON-RPC 2.0)
// ---------------------------------------------------------------------------
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}
function sendResult(id, result) { send({ jsonrpc: '2.0', id, result }); }
function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

// ---------------------------------------------------------------------------
// Описания инструментов (tools/list)
// ---------------------------------------------------------------------------
function strSchema(extra) {
  return { type: 'object', properties: extra, additionalProperties: false };
}

const TOOLS = [
  {
    name: 'get_reference',
    description: 'Справочник допустимых значений и описание полей задачи.',
    inputSchema: strSchema({}),
  },
  {
    name: 'list_tasks',
    description: 'Список задач с фильтрами. Все фильтры опциональны.',
    inputSchema: strSchema({
      status: { type: 'string', description: 'Фильтр по статусу (см. get_reference)' },
      priority: { type: 'string', description: 'Фильтр по приоритету' },
      type: { type: 'string', description: 'Фильтр по типу' },
      assigneeId: { type: 'string', description: 'id исполнителя (см. list_people)' },
      sprintId: { type: 'string', description: 'id спринта (см. list_sprints)' },
      epicId: { type: 'string', description: 'id эпика (см. list_epics)' },
      project: { type: 'string', description: 'Фильтр по проекту' },
      search: { type: 'string', description: 'Подстрока в названии или id' },
      includeDeleted: { type: 'boolean', description: 'Показывать удалённые (по умолчанию нет)' },
      limit: { type: 'number', description: 'Максимум задач в ответе' },
    }),
  },
  {
    name: 'get_task',
    description: 'Получить одну задачу по id.',
    inputSchema: strSchema({ id: { type: 'string', description: 'id задачи' } }),
  },
  {
    name: 'create_task',
    description: 'Создать задачу. Обязательно только title.',
    inputSchema: strSchema({
      title: { type: 'string', description: 'Название (обязательно)' },
      description: { type: 'string' }, comment: { type: 'string' },
      aiTracker: { type: 'string', description: 'Ссылка на задачу в другом трекере' },
      status: { type: 'string', description: 'Статус (по умолчанию «Новая»)' },
      priority: { type: 'string', description: 'Приоритет (по умолчанию «Средний»)' },
      type: { type: 'string', description: 'Тип (по умолчанию «Фича»)' },
      taskClass: { type: 'string', description: 'Класс задачи (P1/P2/P3)' },
      project: { type: 'string' }, size: { type: 'string', description: 'S/M/L/XL/XXL' },
      deadline: { type: 'string', description: 'Дедлайн, формат YYYY-MM-DD' },
      sprintId: { type: 'string' }, epicId: { type: 'string' }, assigneeId: { type: 'string' },
    }),
  },
  {
    name: 'update_task',
    description: 'Изменить поля существующей задачи. Передаются только изменяемые поля.',
    inputSchema: strSchema({
      id: { type: 'string', description: 'id задачи (обязательно)' },
      title: { type: 'string' }, description: { type: 'string' }, comment: { type: 'string' },
      aiTracker: { type: 'string' }, status: { type: 'string' }, priority: { type: 'string' },
      type: { type: 'string' }, taskClass: { type: 'string' }, project: { type: 'string' },
      size: { type: 'string' }, deadline: { type: 'string' },
      sprintId: { type: 'string' }, epicId: { type: 'string' }, assigneeId: { type: 'string' },
    }),
  },
  {
    name: 'set_ai_tracker',
    description: 'Проставить задаче поле aiTracker (ссылку на задачу в другом трекере).',
    inputSchema: strSchema({
      id: { type: 'string', description: 'id задачи' },
      aiTracker: { type: 'string', description: 'Ссылка или текст со ссылкой' },
    }),
  },
  {
    name: 'delete_task',
    description: 'Удалить задачу (мягкое удаление — помечает deleted).',
    inputSchema: strSchema({ id: { type: 'string', description: 'id задачи' } }),
  },
  {
    name: 'list_sprints',
    description: 'Список спринтов.',
    inputSchema: strSchema({ includeDeleted: { type: 'boolean' } }),
  },
  {
    name: 'create_sprint',
    description: 'Создать спринт.',
    inputSchema: strSchema({
      name: { type: 'string', description: 'Название (обязательно)' },
      startDate: { type: 'string', description: 'Дата начала YYYY-MM-DD (обязательно)' },
      endDate: { type: 'string', description: 'Дата окончания YYYY-MM-DD (обязательно)' },
    }),
  },
  {
    name: 'update_sprint',
    description: 'Изменить спринт (имя, даты, статус).',
    inputSchema: strSchema({
      id: { type: 'string', description: 'id спринта (обязательно)' },
      name: { type: 'string' }, startDate: { type: 'string' }, endDate: { type: 'string' },
      status: { type: 'string', description: 'pending/active/completed' },
    }),
  },
  {
    name: 'list_epics',
    description: 'Список эпиков.',
    inputSchema: strSchema({ includeDeleted: { type: 'boolean' } }),
  },
  {
    name: 'create_epic',
    description: 'Создать эпик.',
    inputSchema: strSchema({
      name: { type: 'string', description: 'Название (обязательно)' },
      description: { type: 'string' }, project: { type: 'string' },
      color: { type: 'string', description: 'Цвет в hex, напр. #B8E0F4' },
    }),
  },
  {
    name: 'update_epic',
    description: 'Изменить эпик.',
    inputSchema: strSchema({
      id: { type: 'string', description: 'id эпика (обязательно)' },
      name: { type: 'string' }, description: { type: 'string' }, project: { type: 'string' }, color: { type: 'string' },
    }),
  },
  {
    name: 'list_people',
    description: 'Список исполнителей (people).',
    inputSchema: strSchema({ includeDeleted: { type: 'boolean' } }),
  },
  {
    name: 'create_person',
    description: 'Создать исполнителя.',
    inputSchema: strSchema({
      name: { type: 'string', description: 'Фамилия/имя (обязательно)' },
      color: { type: 'string', description: 'Цвет в hex' },
    }),
  },
  {
    name: 'list_notes',
    description: 'Заметки (по вкладкам-категориям).',
    inputSchema: strSchema({ category: { type: 'string', description: 'Название вкладки (по умолчанию все)' } }),
  },
  {
    name: 'add_note',
    description: 'Добавить заметку в категорию.',
    inputSchema: strSchema({
      category: { type: 'string', description: 'Название вкладки (обязательно)' },
      text: { type: 'string', description: 'Текст заметки (обязательно)' },
    }),
  },
];

const TOOLS_BY_NAME = {};
TOOLS.forEach((t) => { TOOLS_BY_NAME[t.name] = t; });

// ---------------------------------------------------------------------------
// Обработчики инструментов
// ---------------------------------------------------------------------------
function textResult(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}
function requireArg(args, name, label) {
  const v = args[name];
  if (v === undefined || v === null || v === '') {
    throw new Error(`Нужен аргумент «${label || name}»`);
  }
  return v;
}

function getReference() {
  return {
    statuses: STATUSES,
    priorities: PRIORITIES,
    types: TYPES,
    sizes: SIZES,
    taskClasses: TASK_CLASSES,
    sprintStatuses: SPRINT_STATUSES,
    taskFields: {
      id: 'string — уникальный числовой id (строка)',
      title: 'string — название (обязательно)',
      description: 'string — описание',
      comment: 'string — комментарий',
      aiTracker: 'string — ссылка на задачу в другом трекере (заполняет агент)',
      status: 'string — один из statuses',
      priority: 'string — один из priorities',
      type: 'string — один из types',
      taskClass: 'string — один из taskClasses (P1/P2/P3), может быть пустым',
      project: 'string — название проекта',
      size: 'string — один из sizes',
      deadline: 'string — YYYY-MM-DD',
      sprintId: 'string — id спринта (пусто = бэклог)',
      epicId: 'string — id эпика (пусто = без эпика)',
      assigneeId: 'string — id исполнителя (пусто = без исполнителя)',
      createdAt: 'string — ISO дата создания (автоматически)',
      updatedAt: 'number — timestamp мс (автоматически, для merge)',
      deleted: 'boolean — tombstone удаления',
    },
  };
}

function listTasks(a) {
  return readItems('tasks').then(({ map }) => {
    let arr = Object.keys(map).map((k) => map[k]);
    if (!a.includeDeleted) arr = arr.filter((t) => !isTombstone(t));
    if (a.status) arr = arr.filter((t) => t.status === a.status);
    if (a.priority) arr = arr.filter((t) => t.priority === a.priority);
    if (a.type) arr = arr.filter((t) => t.type === a.type);
    if (a.assigneeId !== undefined) arr = arr.filter((t) => String(t.assigneeId || '') === String(a.assigneeId));
    if (a.sprintId !== undefined) arr = arr.filter((t) => String(t.sprintId || '') === String(a.sprintId));
    if (a.epicId !== undefined) arr = arr.filter((t) => String(t.epicId || '') === String(a.epicId));
    if (a.project) arr = arr.filter((t) => (t.project || '') === a.project);
    if (a.search) {
      const s = String(a.search).toLowerCase();
      arr = arr.filter((t) =>
        (t.title || '').toLowerCase().includes(s) ||
        String(t.id).toLowerCase().includes(s));
    }
    if (a.limit && arr.length > a.limit) arr = arr.slice(0, a.limit);
    return { count: arr.length, tasks: arr };
  });
}

function getTask(a) {
  const id = requireArg(a, 'id', 'id задачи');
  return readItems('tasks').then(({ map }) => {
    const t = map[String(id)];
    if (!t) throw new Error(`Задача id=${id} не найдена`);
    return t;
  });
}

// Общие поля задачи для create/update: берём только известные и заданные.
function pickTaskFields(a) {
  const out = {};
  Object.keys(TASK_FIELDS).forEach((k) => {
    if (a[k] !== undefined && a[k] !== null && a[k] !== '') out[k] = a[k];
  });
  return out;
}

function createTask(a) {
  const title = requireArg(a, 'title', 'title');
  return mutateItems('tasks', (map) => {
    const id = nextId(map);
    const now = Date.now();
    const task = {
      id,
      title,
      description: a.description || '',
      comment: a.comment || '',
      aiTracker: a.aiTracker || '',
      status: a.status || 'Новая',
      priority: a.priority || 'Средний',
      type: a.type || 'Фича',
      taskClass: a.taskClass || '',
      project: a.project || '',
      size: a.size || '',
      deadline: a.deadline || '',
      sprintId: a.sprintId || '',
      epicId: a.epicId || '',
      assigneeId: a.assigneeId || '',
      createdAt: new Date().toISOString(),
      updatedAt: now,
    };
    if (task.status === 'В работе' && !task.startWorkAt) task.startWorkAt = new Date().toISOString();
    map[id] = task;
    return { id, task };
  });
}

function updateTask(a) {
  const id = requireArg(a, 'id', 'id задачи');
  const patch = pickTaskFields(a);
  if (Object.keys(patch).length === 0) throw new Error('Не передано ни одного изменяемого поля');
  return mutateItems('tasks', (map) => {
    const t = map[String(id)];
    if (!t) throw new Error(`Задача id=${id} не найдена`);
    Object.assign(t, patch, { updatedAt: Date.now() });
    return t;
  });
}

function setAiTracker(a) {
  const id = requireArg(a, 'id', 'id задачи');
  const aiTracker = requireArg(a, 'aiTracker', 'aiTracker');
  return mutateItems('tasks', (map) => {
    const t = map[String(id)];
    if (!t) throw new Error(`Задача id=${id} не найдена`);
    t.aiTracker = aiTracker;
    t.updatedAt = Date.now();
    return t;
  });
}

function deleteTask(a) {
  const id = requireArg(a, 'id', 'id задачи');
  return mutateItems('tasks', (map) => {
    const t = map[String(id)];
    if (!t) throw new Error(`Задача id=${id} не найдена`);
    t.deleted = true;
    t.updatedAt = Date.now();
    return { id: String(id), deleted: true };
  });
}

// ---- Спринты ----
function listSprints(a) {
  return readItems('sprints').then(({ map }) => {
    let arr = Object.keys(map).map((k) => map[k]);
    if (!a.includeDeleted) arr = arr.filter((s) => !isTombstone(s));
    return { count: arr.length, sprints: arr };
  });
}

function createSprint(a) {
  const name = requireArg(a, 'name', 'name');
  const startDate = requireArg(a, 'startDate', 'startDate');
  const endDate = requireArg(a, 'endDate', 'endDate');
  if (startDate > endDate) throw new Error('Дата начала позже даты окончания');
  return mutateItems('sprints', (map) => {
    const id = nextId(map);
    const sprint = { id, name, startDate, endDate, status: 'pending', updatedAt: Date.now() };
    map[id] = sprint;
    return { id, sprint };
  });
}

function updateSprint(a) {
  const id = requireArg(a, 'id', 'id спринта');
  return mutateItems('sprints', (map) => {
    const s = map[String(id)];
    if (!s) throw new Error(`Спринт id=${id} не найден`);
    if (a.name !== undefined) s.name = a.name;
    if (a.startDate !== undefined) s.startDate = a.startDate;
    if (a.endDate !== undefined) s.endDate = a.endDate;
    if (a.status !== undefined) s.status = a.status;
    s.updatedAt = Date.now();
    return s;
  });
}

// ---- Эпики ----
function listEpics(a) {
  return readItems('epics').then(({ map }) => {
    let arr = Object.keys(map).map((k) => map[k]);
    if (!a.includeDeleted) arr = arr.filter((e) => !isTombstone(e));
    return { count: arr.length, epics: arr };
  });
}

function pickFreeColor(map) {
  const used = new Set(Object.keys(map).map((k) => map[k] && map[k].color));
  return COLORS.find((c) => !used.has(c)) || COLORS[Object.keys(map).length % COLORS.length];
}

function createEpic(a) {
  const name = requireArg(a, 'name', 'name');
  return mutateItems('epics', (map) => {
    const id = nextId(map);
    const epic = {
      id,
      name,
      description: a.description || '',
      project: a.project || '',
      color: a.color || pickFreeColor(map),
      createdAt: new Date().toISOString(),
      updatedAt: Date.now(),
    };
    map[id] = epic;
    return { id, epic };
  });
}

function updateEpic(a) {
  const id = requireArg(a, 'id', 'id эпика');
  return mutateItems('epics', (map) => {
    const e = map[String(id)];
    if (!e) throw new Error(`Эпик id=${id} не найден`);
    if (a.name !== undefined) e.name = a.name;
    if (a.description !== undefined) e.description = a.description;
    if (a.project !== undefined) e.project = a.project;
    if (a.color !== undefined) e.color = a.color;
    e.updatedAt = Date.now();
    return e;
  });
}

// ---- Исполнители (people) ----
function listPeople(a) {
  return readItems('people').then(({ map }) => {
    let arr = Object.keys(map).map((k) => map[k]);
    if (!a.includeDeleted) arr = arr.filter((p) => !isTombstone(p));
    return { count: arr.length, people: arr };
  });
}

function createPerson(a) {
  const name = requireArg(a, 'name', 'name');
  return mutateItems('people', (map) => {
    const id = nextId(map);
    const person = {
      id,
      name,
      color: a.color || pickFreeColor(map),
      createdAt: new Date().toISOString(),
      updatedAt: Date.now(),
    };
    map[id] = person;
    return { id, person };
  });
}

// ---- Заметки ----
function listNotes(a) {
  return readItems('notes').then(({ map }) => {
    if (a.category) {
      return { category: a.category, notes: map[a.category] || [] };
    }
    return map;
  });
}

function addNote(a) {
  const category = requireArg(a, 'category', 'category');
  const text = requireArg(a, 'text', 'text');
  return mutateItems('notes', (map) => {
    const arr = Array.isArray(map[category]) ? map[category] : [];
    const note = { id: 'n_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6), text };
    arr.push(note);
    map[category] = arr;
    return { category, note };
  });
}

// ---------------------------------------------------------------------------
// Диспетчер инструментов
// ---------------------------------------------------------------------------
const HANDLERS = {
  get_reference: getReference,
  list_tasks: listTasks,
  get_task: getTask,
  create_task: createTask,
  update_task: updateTask,
  set_ai_tracker: setAiTracker,
  delete_task: deleteTask,
  list_sprints: listSprints,
  create_sprint: createSprint,
  update_sprint: updateSprint,
  list_epics: listEpics,
  create_epic: createEpic,
  update_epic: updateEpic,
  list_people: listPeople,
  create_person: createPerson,
  list_notes: listNotes,
  add_note: addNote,
};

async function callTool(name, args) {
  const handler = HANDLERS[name];
  if (!handler) throw new Error(`Неизвестный инструмент: ${name}`);
  const data = await handler(args || {});
  return data;
}

// ---------------------------------------------------------------------------
// Обработка входящих JSON-RPC сообщений
// ---------------------------------------------------------------------------
async function handleMessage(msg) {
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      sendResult(id, {
        protocolVersion: params && params.protocolVersion ? params.protocolVersion : '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'siberia-mcp', version: '1.0.0' },
      });
      return;
    }
    if (method === 'tools/list') {
      sendResult(id, { tools: TOOLS });
      return;
    }
    if (method === 'tools/call') {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      const data = await callTool(name, args);
      sendResult(id, textResult(data));
      return;
    }
    if (method === 'ping') {
      sendResult(id, {});
      return;
    }
    // notifications/* и прочее — без ответа.
    if (id === undefined) return;
    sendError(id, -32601, `Метод не поддерживается: ${method}`);
  } catch (e) {
    if (id !== undefined) {
      sendResult(id, { content: [{ type: 'text', text: 'Ошибка: ' + (e && e.message ? e.message : String(e)) }], isError: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Чтение stdin построчно (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { continue; }
    handleMessage(msg);
  }
});
process.stdin.on('end', () => {
  const line = buffer.trim();
  if (line) { try { handleMessage(JSON.parse(line)); } catch (e) {} }
});


