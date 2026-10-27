# MCP-сервер для трекера SIBERIA

`siberia-mcp.mjs` — сервер по протоколу Model Context Protocol (MCP), который даёт
ИИ-ассистентам (Cursor, Claude Desktop, агентам) доступ к задачам трекера SIBERIA.

Работает через stdio (newline-delimited JSON-RPC), без внешних зависимостей — нужен
только Node.js 18+.

## Запуск

Сервер читает данные из Firestore проекта `siberia-777` (тот же боевой проект, что
использует задеплоенный сайт). Для доступа нужен пользователь Firebase Auth
(Email/Password) этого проекта:

```bash
SIBERIA_EMAIL=user@example.com SIBERIA_PASSWORD=secret \
  node tools/siberia-mcp.mjs
```

Переменные окружения:

| Переменная | Назначение | По умолчанию |
|-----------|-----------|--------------|
| `SIBERIA_EMAIL` | Email пользователя Firebase Auth (обязательно) | — |
| `SIBERIA_PASSWORD` | Пароль (обязательно) | — |
| `SIBERIA_PROJECT` | id Firebase-проекта | `siberia-777` |
| `SIBERIA_API_KEY` | Web API key | боевой ключ `siberia-777` |

> ⚠️ Не менять `SIBERIA_PROJECT` и `SIBERIA_API_KEY` — иначе сервер будет читать/писать
> другой проект, и задачи «пропадут».

## Быстрая проверка (без клиента)

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | SIBERIA_EMAIL=... SIBERIA_PASSWORD=... node tools/siberia-mcp.mjs
```

## Подключение в Cursor

В файле `.cursor/mcp.json` в корне проекта:

```json
{
  "mcpServers": {
    "siberia": {
      "command": "node",
      "args": ["tools/siberia-mcp.mjs"],
      "env": {
        "SIBERIA_EMAIL": "user@example.com",
        "SIBERIA_PASSWORD": "secret"
      }
    }
  }
}
```

## Подключение в Claude Desktop

В `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "siberia": {
      "command": "node",
      "args": ["/abs/path/to/tools/siberia-mcp.mjs"],
      "env": {
        "SIBERIA_EMAIL": "user@example.com",
        "SIBERIA_PASSWORD": "secret"
      }
    }
  }
}
```

## Инструменты

| Инструмент | Что делает |
|-----------|-----------|
| `get_reference` | Справочник допустимых значений (статусы, приоритеты, типы, размеры, классы) и поля задачи |
| `list_tasks` | Список задач с фильтрами (статус, приоритет, тип, исполнитель, спринт, эпик, проект, поиск) |
| `get_task` | Одна задача по id |
| `create_task` | Создать задачу |
| `update_task` | Изменить поля задачи |
| `set_ai_tracker` | Проставить ссылку `aiTracker` (поле для агента) |
| `delete_task` | Удалить задачу (мягкое удаление) |
| `list_sprints` / `create_sprint` / `update_sprint` | Спринты |
| `list_epics` / `create_epic` / `update_epic` | Эпики |
| `list_people` / `create_person` | Исполнители |
| `list_notes` / `add_note` | Заметки |

## Важные детали записи

- Данные лежат в Firestore в коллекции `siberia_tracker`, в каждом документе — поле
  `items` (карта `id → элемент`).
- При любом изменении элемента сервер **поднимает `updatedAt`** (`Date.now()`), иначе
  merge по `updatedAt` в приложении отбросит правку. Остальные поля элемента при записи
  сохраняются целиком.
- Удаление — мягкое (tombstone-поле `deleted`), как в приложении.
- id задач/спринтов/эпиков/исполнителей — числовые строки, следующий id = максимальный + 1.
