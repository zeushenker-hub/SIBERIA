#!/usr/bin/env node
// Перенос данных Firestore: проект ihome-app777 -> siberia-777.
// Коллекция одна и та же: siberia_tracker.
//
// Запуск (только чтение-проверка, ничего не пишет):
//   node tools/migrate-to-siberia777.mjs --dry-run
//
// Реальный перенос:
//   node tools/migrate-to-siberia777.mjs
//
// Если правила siberia-777 требуют вход (allow ... if request.auth != null),
// задайте логин пароль пользователя Firebase Auth этого проекта:
//   SIBERIA_EMAIL=user@example.com SIBERIA_PASSWORD=secret \
//     node tools/migrate-to-siberia777.mjs
// либо готовый токен:
//   SIBERIA_ID_TOKEN=eyJ... node tools/migrate-to-siberia777.mjs
//
// Скрипт никогда не удаляет данные источника и не перезаписывает поля,
// которых нет в источнике (пишет через updateMask по именам полей).

import process from 'node:process';

const SOURCE = {
  projectId: process.env.SOURCE_PROJECT || 'ihome-app777',
  apiKey: process.env.SOURCE_API_KEY || 'AIzaSyBRYeMKAJxLQf5B6ZzkCggTlb1ZUf_o75o',
};
const TARGET = {
  projectId: process.env.TARGET_PROJECT || 'siberia-777',
  apiKey: process.env.TARGET_API_KEY || 'AIzaSyB7BMHcSec352z7C7gFmVibVwtMcEtb-XQ',
};
const COLLECTION = 'siberia_tracker';
const DOCS = [
  'tasks', 'sprints', 'mytasks', 'notes', 'hours_features', 'estimates', 'meta',
];
const DRY_RUN = process.argv.includes('--dry-run');

function docUrl(project, doc) {
  return `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${COLLECTION}/${doc}`;
}

async function getTargetToken() {
  if (process.env.SIBERIA_ID_TOKEN) return process.env.SIBERIA_ID_TOKEN;
  const email = process.env.SIBERIA_EMAIL;
  const password = process.env.SIBERIA_PASSWORD;
  if (!email || !password) return null;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${TARGET.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!res.ok || !data.idToken) {
    throw new Error('Не удалось войти в siberia-777: ' + JSON.stringify(data));
  }
  return data.idToken;
}

async function readDoc(project, doc, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${docUrl(project, doc)}?key=${SOURCE.apiKey}`, { headers });
  if (res.status === 404) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(`read ${project}/${doc}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function writeDoc(doc, fields, token) {
  const mask = Object.keys(fields)
    .map((f, i) => `updateMask.fieldPaths=${encodeURIComponent(f)}&`)
    .join('');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(
    `${docUrl(TARGET.projectId, doc)}?key=${TARGET.apiKey}&${mask}`,
    { method: 'PATCH', headers, body: JSON.stringify({ fields }) }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`write ${TARGET.projectId}/${doc}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

function summarize(fields) {
  const items = fields && fields.items;
  if (!items) return 'без items';
  if (items.arrayValue) {
    const all = items.arrayValue.values || [];
    const live = all.filter((v) => !(v.mapValue && v.mapValue.fields && v.mapValue.fields.deleted)).length;
    return `массив: ${all.length} (живых ${live})`;
  }
  if (items.mapValue) return `карта: ${Object.keys(items.mapValue.fields || {}).length}`;
  return 'items';
}

const token = await getTargetToken();
console.log(`Источник: ${SOURCE.projectId}`);
console.log(`Цель:     ${TARGET.projectId}` + (DRY_RUN ? '  [DRY-RUN, запись отключена]' : ''));
console.log(`Auth:     ${token ? 'есть токен' : 'без токена (правила должны разрешать запись)'}`);
console.log('');

let ok = 0;
for (const doc of DOCS) {
  try {
    const src = await readDoc(SOURCE.projectId, doc, null);
    if (!src) {
      console.log(`— ${doc}: в источнике отсутствует, пропускаю`);
      continue;
    }
    const fields = src.fields || {};
    console.log(`→ ${doc}: ${summarize(fields)}`);
    if (!DRY_RUN) {
      await writeDoc(doc, fields, token);
      console.log(`  записано в ${TARGET.projectId}/${COLLECTION}/${doc}`);
    }
    ok++;
  } catch (e) {
    console.error(`✗ ${doc}: ${e.message}`);
    process.exitCode = 1;
  }
}
console.log('');
console.log(DRY_RUN ? `Проверено документов: ${ok}` : `Перенесено документов: ${ok}`);
if (DRY_RUN) console.log('Для реального переноса запустите без --dry-run.');
