# Разработка

## Что нужно

Node.js 22+, Rust (stable, MSVC), WebView2 (есть в Windows 10/11).

```bash
npm install
```

## Запуск

```bash
npm run tauri dev
```

Чтобы не трогать реальные данные, debug-сборка берёт папку данных из `FAMILY_BUDGET_DATA_DIR`:

```powershell
$env:FAMILY_BUDGET_DATA_DIR = "D:\fb-test"; npm run tauri dev
```

## Проверки

| Команда | Что делает |
|---|---|
| `npm run check` | TypeScript, ESLint, Vitest, Clippy, cargo test — всё разом |
| `npm run test:rust` | Финансовое ядро и сценарии на настоящей SQLite |
| `npm run test` | Логика интерфейса (деньги, формы) |
| `npm run e2e` | UI-тесты в реальном приложении (см. ниже) |
| `npm run tauri build` | Установщик `src-tauri/target/release/bundle/nsis/*.exe` |

## E2E-тесты

`npm run e2e` гоняет настоящее приложение: Playwright запускает dev-сервер Vite, затем
`src-tauri/target/debug/family-budget.exe` (соберите его заранее: `cargo build --manifest-path src-tauri/Cargo.toml`)
и подключается к WebView2 по протоколу отладки. Каждый тест получает пустую временную папку данных
(`FAMILY_BUDGET_DATA_DIR`), реальные данные не трогаются. Скриншоты экранов складываются в `test-results/`.

Системные диалоги выбора файла тест нажать не может, поэтому debug-сборка с `FAMILY_BUDGET_E2E=1` берёт ответ
из файла `e2e-dialog.txt` в папке данных (`app.answerDialog(path)` в `e2e/app.ts`). Релизная сборка этого не умеет.

## Структура

```
src-tauri/src/domain    чистая финансовая логика
src-tauri/src/app       сценарии поверх SQLite (+ scenarios.rs — тесты ТЗ)
src-tauri/src/db        подключение, миграции, справочники
src-tauri/src/commands  IPC-команды для интерфейса
src-tauri/migrations    SQL-миграции
e2e/                    UI-тесты на реальном приложении
src/lib/api.ts          типизированные вызовы команд
src/features/*          экраны
src/components          общие компоненты и shadcn/ui
```

## Правила

- Деньги в интерфейсе — только через `src/lib/money.ts` (строки ↔ целые единицы), без float.
- Новая команда: функция в `app/` (+ тест) → команда в `commands/` → регистрация в `lib.rs` → метод в `src/lib/api.ts`.
- Изменение схемы — только новой миграцией `000N_*.sql` и записью в `db/migrations.rs`.
