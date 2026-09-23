#!/usr/bin/env node
// Восстановление («воскрешение») задачи по id: убирает поле deleted и ставит
// свежий updatedAt, чтобы запись снова стала видимой в трекере.
//
// Запуск (из корня проекта):
//   SIBERIA_EMAIL=user@example.com SIBERIA_PASSWORD=secret \
//     node tools/undelete-task.mjs 154
//
// Пишет только документ tasks в проекте siberia-777.

import process from 'node:process';

const TARGET = {
  projectId: 'siberia-777',
  apiKey: 'AIzaSyB7BMHcSec352z7C7gFmVibVwtMcEtb-XQ',
};
const COLLECTION = 'siberia_tracker';

const taskId = process.argv[2];
if (!taskId) {
  console.error('Укажи id задачи: node tools/undelete-task.mjs 154');
  process.exit(1);
}

function docUrl(doc) {
  return `https://firestore.googleapis.com/v1/projects/${TARGET.projectId}/databases/(default)/documents/${COLLECTION}/${doc}`;
}

async function getToken() {
  const email = process.env.SIBERIA_EMAIL;
  const password = process.env.SIBERIA_PASSWORD;
  if (!email || !password) throw new Error('Нужны SIBERIA_EMAIL и SIBERIA_PASSWORD');
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${TARGET.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!res.ok || !data.idToken) throw new Error('Не удалось войти: ' + JSON.stringify(data));
  return data.idToken;
}

// Firestore REST value -> обычное JS-значение.
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

const token = await getToken();
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

const res = await fetch(`${docUrl('tasks')}?key=${TARGET.apiKey}`, { headers });
if (!res.ok) throw new Error(`read tasks: ${res.status} ${await res.text()}`);
const doc = await res.json();
const itemsField = doc.fields && doc.fields.items;
if (!itemsField) throw new Error('В документе tasks нет поля items');

const items = fromRest(itemsField);
let target;
if (Array.isArray(items)) {
  target = items.find((el) => el && String(el.id) === String(taskId));
} else if (items && typeof items === 'object') {
  target = items[String(taskId)];
}
if (!target) throw new Error(`Задача id=${taskId} не найдена`);

if (!target.deleted) {
  console.log(`Задача ${taskId} не помечена удалённой — ничего не меняю.`);
  process.exit(0);
}

delete target.deleted;
target.updatedAt = Date.now();

const mask = 'updateMask.fieldPaths=' + encodeURIComponent('items');
const patch = await fetch(`${docUrl('tasks')}?key=${TARGET.apiKey}&${mask}`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ fields: { items: toRest(items) } }),
});
if (!patch.ok) throw new Error(`write tasks: ${patch.status} ${await patch.text()}`);

console.log(`Готово: задача ${taskId} восстановлена (updatedAt=${target.updatedAt}).`);
console.log('Обнови трекер — задача появится в списке и в поиске.');
