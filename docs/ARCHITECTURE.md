# Forest Chopper — архитектура

> **Актуальная карта реализации (2026-11-01).** Это описание текущего кода, а не проект будущего движка.
> Для целей и правил игрового опыта см. [GAME_DESIGN.md](GAME_DESIGN.md),
> для конкретных механик — [GAME_MECHANICS_CATALOG.md](GAME_MECHANICS_CATALOG.md).
> При расхождении с этим текстом проверяйте исходники и тесты.

## 1. Система в целом

Forest Chopper — статическое веб-приложение из нативных ES-модулей JS и отдельный
Python WebSocket-сервер. Сборщик и React не требуются; Three.js и GLTFLoader
загружаются через CDN. Игрок может играть без Python-сервера (offline) или
присоединиться к общему серверному миру (online).

```text
index.html / index_debug.html
  └─ src/main-menu.js + main-menu-state.js + main-menu.css
       ├─ localStorage: метаданные сохранения, настройки, недавние серверы
       ├─ /status: разовый WebSocket-запрос, не создаёт игрока
       └─ динамический import(src/main.js) только по команде «Играть»
            ├─ Three.js: renderer / scene / camera / GLB / GPU-ресурсы
            ├─ ctx: общая точка доступа к модулям и состоянию игры
            ├─ world.js, terrain.js, distant-forest.js, micro-grass.js
            │    └─ WorldTaskScheduler → world-stream-worker.js
            ├─ player.js: requestAnimationFrame / движение / отрисовка
            ├─ controls.js, pickup-interaction.js, inventory-ui.js
            ├─ offline-save.js / progress.js / day-cycle.js
            ├─ multiplayer.js ─ WebSocket или PeerJS bridge
            │                     └─ forest_server.py (серверный мир)
            └─ world-startup.js: загрузочный overlay на этапе заполнения мира
```

Публичный `index.html` **не** создаёт `window.__gameDebug`; он доступен только
в `index_debug.html` после запуска игры. Другие точки входа — инструменты
редактирования 3D в `characters/humanoid/`, не часть главного меню.

## 2. Жизненный цикл и границы состояний

1. **Меню.** Не создаются Three.js/WebGL-контекст, игровые объекты и worker-ы.
   `src/main-menu-state.js` читает существующий offline-save, но не загружает мир.
   `src/settings.js` позволяет сохранять графические параметры до создания renderer.
2. **Выбор режима.** `continue` восстанавливает сохранение,
   `new` задаёт seed 0–999998 и сбрасывает прошлый локальный мир,
   `online` настраивает сервер/P2P. Параметры запуска передаются в
   `globalThis.__forestLaunch` с резервной записью в `sessionStorage`.
3. **Загрузка модулей.** `src/main.js` создаёт scene, renderer, общие геометрии,
   модель персонажа и игровые системы, после чего запускает frame loop.
4. **Готовность.** `src/world-startup.js` держит экран загрузки минимум 3 и
   максимум 5 секунд **после начала рендеринга**: ожидаются 5×5 ближайших
   детальных чанков (или меньшая область на Low), 3×3 тайла рельефа, начальная
   трава, первая партия дальнего леса и подключение в online. Успешная готовность
   должна стабилизироваться 350 мс. Ограничение в 5 секунд исключает зависание;
   дальние чанки могут продолжить появляться после перехода.
5. **Игра.** `src/player.js` ведёт `requestAnimationFrame`, физику, анимацию
   и кадры renderer. Мировые чанки обновляются инкрементально.
6. **Выход в меню.** Offline-save сбрасывается на диск браузера (если доступно),
   сетевой клиент отключается, затем `location.reload()`. Освобождение ресурсов
   WebGL выполняет браузер, а не сложный ручной teardown всех модулей.

Нельзя переносить создание renderer/воркеров в начальную загрузку меню:
это нарушит его лёгкую точку входа и предварительное применение MSAA.

## 3. Пакеты и ответственность

| Область | Файлы | Контракт |
| --- | --- | --- |
| Запуск/UI | `main-menu.js`, `main-menu-state.js`, `settings.js` | Меню не запускает движок; сохраняет настройки и выбор режима |
| Оркестрация | `main.js` | Собирает `ctx`; поддерживает offline и online |
| Мир | `world.js`, `tree-spacing.js`, `terrain-noise.js`, `ponds.js`, `lakes.js` | Детерминированное распределение по seed и координатам |
| Стриминг | `world-task-scheduler.js`, `world-stream-data.js`, `world-stream-worker.js`, `terrain.js`, `distant-forest.js`, `micro-grass.js` | Генерация вне render loop, ограниченное применение результатов; см. [world-streaming.md](world-streaming.md) |
| Персонаж | `animations.js`, `player.js`, `physics.js`, `orbit-camera.js` | Существующий игровой GLB `lumberjack/lumberjack.glb`, root motion, коллизии |
| Игра | `chopping.js`, `building.js`, `inventory.js`, `crafting.js`, `vitals.js` | Действия, ограничения, ресурсы |
| Подбор | `forest-resources.js`, `collectible-decor.js`, `resource-zones.js`, `ground-boxes.js`, `pickup-interaction.js`, `aim-state.js` | Доступность, расстояние, наведение и визуальный feedback; сервер подтверждает онлайн-действия |
| Персистентность | `offline-save.js`, `progress.js`, `tutorial.js`, `day-cycle.js` | Валидация локальных данных, сохранение прогресса/фазы |
| Сеть | `multiplayer.js`, `peer-bridge.js`, `forest_server.py` | Авторитетные изменения общего мира на сервере |
| Боты | `server_bots.py`, `bot_gateway.py`, `bot_mcp.py`, `bot_cli.py` | Серверные AI-игроки без Three.js и браузера; [SERVER_BOTS.md](SERVER_BOTS.md) |

Экспериментальный модульный Humanoid Lite живёт отдельно в
`characters/humanoid/`: игровой runtime **по-прежнему использует**
`lumberjack/lumberjack.glb` (см. `src/animations.js`). Не смешивать
художественный pipeline и готовую игровую интеграцию.

## 4. Процедурный мир и GPU

- Мир состоит из 24-метровых детальных лесных чанков. Рельеф стримится
  более крупными тайлами (в текущем коде 96 м).
- Истинная высота грунта для коллизий вычисляется аналитически; renderer
  получает worker-сгенерированные сетки. Изменения seed/параметров должны
  отменять устаревшие результаты.
- Дальний лес объединяется в независимые 96-метровые сектора GPU Instancing;
  frustum culling выполняет Three.js.
- Трава использует отдельные near/far LOD и пул InstancedMesh.
- Пресеты графики объявлены в `src/performance-presets.js`: Ultra/High
  используют MSAA, Medium/Low — без MSAA. Изменение антиалиасинга требует
  нового WebGL-контекста; остальные поддерживаемые параметры применяются
  через настройки/пересоздание нужных батчей.
- Для геометрии и кешей действуют бюджеты; ручная проверка производительности
  на Intel iGPU/NVIDIA остаётся важной даже при зелёных unit-тестах.

## 5. Локальные данные и серверный мир

| Хранилище | Где | Содержание |
| --- | --- | --- |
| `forest-chopper:offline-world:v1` | браузер, localStorage | Схема `version:1`, seed, координаты, felled/damage, брёвна, мебель, inventory, vitals, cooldowns, boxes, `dayPhase`. Парсинг — `parseOfflineSave` |
| `forest-chopper:progress:v1` | localStorage | Счётчики и локальные задания мира |
| `forest-chopper:achievements:v1` | localStorage | Полученные достижения между новыми мирами |
| `forest-chopper:tutorial:v1` | localStorage | Прогресс обучения (сбрасывается при новом мире) |
| Другие ключи настроек / серверов | localStorage | Графика, профили деревьев, имя, история и избранные адреса; см. `settings.js` и `main-menu-state.js` |
| `forest-chopper:launch:v1` | sessionStorage (резерв) | Одноразовый режим запуска; основная передача — `__forestLaunch` |
| `forest_world.json` (или `--save`) | Python-сервер | Общий seed, деревья, постройки, коробки, cooldowns, `community_cuts`, `day_epoch`, `world_created_at` |

Проверки перед чтением локального мира обязательны: сохранение может быть
старой версии, повреждено или недоступно из-за ограничений браузера.
**Подключение к online не перезаписывает offline-save.**
При создании нового мира сохраняются настройки и ранее открытые достижения.

## 6. Сеть: точки входа и время

- Прямое подключение к Python `websockets` по `ws://` или `wss://`
  (для страницы по HTTPS нужен WSS).
- `/status` — отдельный одноразовый WebSocket-путь: отвечает
  `server_status` с `online`, `max_players`, `world_seed`,
  `world_created_at`, `day_phase`, `protocol_version:1`; **не**
  создаёт участника и не занимает слот. На старых серверах может отсутствовать.
- `/bots` — отдельная точка для headless-ботов с собственной моделью доступа.
- Основной WebSocket начинает с `welcome`. Сервер проверяет рубку,
  сбор/подбор предметов, инвентарь, постройки, чат и общее состояние.
  Успешное действие подтверждается серверным событием; локально не следует
  оптимистично считать его завершённым.
- PeerJS — сигнализация/транспортный мост, а **не** источник игрового состояния.
- Время суток: `day_phase` приходит в `welcome`, затем `time_sync`
  примерно каждые 10 секунд. Клиент экстраполирует между пакетами;
  сервер хранит абсолютную эпоху дня. Цикл — 8 минут.
- Онлайн-игрок получает своё временное состояние инвентаря/vitals;
  долговременное сохранение **общего мира** и постоянный персональный аккаунт
  — разные вещи. Системы аккаунтов в проекте нет.

Если меняется сетевой пакет, ID ресурса или save-схема — синхронизировать
Python/JS и добавить проверки совместимости.

## 7. Тестирование и безопасная разработка

```bash
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -v
python3 -m py_compile forest_server.py server_bots.py bot_gateway.py bot_mcp.py bot_cli.py
for f in src/*.js; do node --check "$f" || exit 1; done
git diff --check
```

Для UI открыть `index.html` и `index_debug.html` в **отдельных** тестовых
вкладках Chrome DevTools. После загрузки меню надо сначала создать/продолжить
игру, и лишь потом использовать `window.__gameDebug`.
Для сетевых тестов нужен отдельный сервер с `--save /tmp/<unique>.json`,
не рабочий `forest_world.json`.

Подробные правила для coding-агентов — [../AGENTS.md](../AGENTS.md);
для headless AI — [AI_PLAYER.md](AI_PLAYER.md);
для браузерных AI — [AI_PLAYER_DEBUG.md](AI_PLAYER_DEBUG.md).
