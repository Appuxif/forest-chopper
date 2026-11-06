# Forest Chopper — план миграции к единому Game Core и Node.js Game Server

> Статус: **план, реализация не начата**. Проверено по ветке `dev`, HEAD `533f590`, 2026-11-05.
> Цель: максимально переиспользовать существующий JavaScript-код, отделить симуляцию от графики и выполнить переход с Python-сервера на Node.js.
> **Rust и переписывание рендерера не входят в scope.**

## 0. Краткое решение

В корне репозитория создаём две директории:

- `game-core/` — единая **платформонезависимая** симуляция, ES modules JavaScript: состояние мира, детерминированные правила, передвижение и столкновения, инвентарь, взаимодействия, сущности, AI и события. Используется напрямую и в браузере, и в Node.js.
- `game-server/` — headless Node.js-сервер: WebSocket, сессии, команды игроков, игровой тик, сохранения, рассылка состояний, подключение ботов. **Не копирует игровую логику**, только вызывает `game-core`.

Клиент остаётся в `src/` и сохраняет Three.js, HTML/CSS, GLB, GPU-геометрию, звук, камеру, анимации и UI. Весь игровой ввод, влияющий на симуляцию, и все запросы на изменения мира проходят через `GameController`:

- `LocalGameController` → запускает `game-core` в браузере без сети.
- `RemoteGameController` → отправляет действия и предложенную позицию серверу, получает snapshots/events. **Движение выполняется локально через Root Motion и точные коллизии**; сервер применяет грубую проверку с допуском и при необходимости корректирует.

**Ключевой принцип:** UI не изменяет авторитетное игровое состояние сам. Он отправляет намерение игрока, получает результат и визуализирует его.

`Game Core` — **не “Node-specific”**. Node.js — одна из платформ исполнения. Начинать с существующих ESM `.js`, без обязательной миграции в TypeScript и без обязательного бандлера. JSDoc/`.d.ts` можно добавить для проверки контрактов. Не вводить отдельную WASM-обвязку.

### Целевая схема

    index.html / index_debug.html
            |
        src/ (Three.js + UI + input + audio)
            |
        GameController interface
            |
       +----+-----------------------------+
       |                                  |
    LocalGameController              RemoteGameController
       |                                  |
    game-core/                       network transport
    Browser (offline)                     |
                                      game-server/
                                        Node.js
                                           |
                                       game-core/

Локальный и серверный Game Core исполняют **одни и те же игровые правила**, но не обязаны иметь одинаковую физическую точность. **Клиент сохраняет Root Motion и точные коллизии; сервер использует приближённую геометрию и допускает небольшие отклонения**, ограничивая грубые нарушения. Сервер по-прежнему подтверждает урон, предметы и постройки.

## 1. Подтверждённое состояние `dev`

### 1.1. Что уже есть

- `src/main.js` (~34 KB): большой composition root с `ctx`/геттерами, создаёт renderer, сцену, мир, персонажа, игровые модули, offline-save, multiplayer.
- `src/player.js`: `requestAnimationFrame` одновременно обновляет ввод, движение, вертикальную кинематику, root motion из `AnimationMixer`, мобов, ragdoll, сеть, UI, стриминг и рендер. `dt = min(0.05, elapsed)`; **фиксированного серверного тика пока нет**.
- `src/physics.js` + `src/collision-kinematic.js`: текущая обычная ходьба — **собственная кинематическая физика**, а не Rapier. `src/collision-world.js` описывает общие формы столкновений, но получает деревья, постройки и коллайдеры через Three.js `position`, `group`, `userData` и графические коллекции.
- `src/ragdoll.js`, `src/ragdoll-colliders.js`, `src/rapier-loader.js`: Rapier/WASM уже используется для **ragdoll**. Пока не переносить весь ragdoll на сервер автоматически: визуальные позы могут оставаться локальными, но последствия для gameplay должны подтверждаться core.
- `src/world.js`: создание деревьев, HP, ID, камней и части ресурсов смешано с мешами, батчингом и GPU. `src/terrain-noise.js`, `src/tree-spacing.js`, `src/resource-zones.js` и часть других файлов уже чистые.
- `src/chopping.js`: физический смысл удара и эффект объединены с `THREE.Raycaster`, моделью, звуком и визуальными щепками. Контакт — **18-й кадр Chop2**, цель может изменяться до контакта. Нельзя потерять этот контракт.
- `src/building.js`, `src/crafting.js`, `src/camp-structures.js`, `src/storages.js`: правила размещения/демонтажа и визуальные объекты/preview/сетевые отправки смешаны.
- `src/inventory.js`, `src/vitals.js`, `src/status-effects.js`, `src/mob-world.js`, `src/mob-population.js`, `src/mob-ai.js`, `src/mob-flocking.js`, `src/mob-steering.js`, `src/mob-types.js`: значительная часть правил **уже engine-neutral**; основной кандидат на перенос почти без переписывания.
- `src/mobs.js`, `src/ground-boxes.js`, `src/forest-resources.js`, `src/death.js`, `src/vitals-ui.js`, `src/inventory-ui.js`: смешивают модель, сетевые действия и/или визуал. Нужны split model/view.
- `src/multiplayer.js` (~19 KB): WebSocket/PeerJS + рендер удалённых аватаров, создание мешей, очистка мира, UI/чат, разбор пакетов. Это **не чистый transport**.
- `src/offline-save.js`: локальные слоты и разбор snapshot смешаны с чтением `ctx` и восстановлением визуального мира; поддерживаются исторические форматы/aliases.
- `forest_server.py` (~100 KB) + `mob_world.py` и прочие Python-модули: авторитетные правила предметов/мира, WS `/status`, `/bots`, JSON-сохранение, AI-боты. Есть заметное дублирование JS/Python.
- `src/peer-bridge.js`: PeerJS **не заменяет сервер**; гостевые соединения проксируются к авторитетному WebSocket-серверу хоста. Сохранить эту семантику.
- `docs/ARCHITECTURE.md`, `docs/MOBS.md`, `docs/SERVER_BOTS.md`, `docs/world-streaming.md` описывают существующие особенности; их нужно актуализировать после миграции.

### 1.2. Критичный нюанс авторитетности

Сейчас `src/player.js` примерно раз в 100 мс отправляет серверу `{type:'move', x,z,y,yaw,jumping,sprinting}`.
`forest_server.py` проверяет дистанцию, скорость, допустимую высоту, препятствия и прыжок, а затем принимает координаты. То есть сервер **проверяет клиентское перемещение**, но не воспроизводит каждый игровой тик по input commands.

**Решение для экспериментальной миграции: оставить модель «клиент предлагает позицию — сервер проверяет допустимость».** Не требовать точного серверного воспроизведения Root Motion или симуляции каждого input-типа. Сервер знает пределы скорости, крупные препятствия и допускаемое отклонение, а не точную фазу шага.

### 1.3. Особо важные инварианты

- Клиент сохраняет **Root Motion GLB как источник реального движения**: `tickActor()` вычисляет `rootDelta`, а локальные коллизии ограничивают смещение. **Сервер не воспроизводит анимацию, её фазы или точные root-кривые.** Он проверяет фактические координаты, сообщённые клиентом, на допустимость по скорости, времени и крупным препятствиям с ограниченной погрешностью. Это намеренный инженерный компромисс.
- Высота земли и воды должна совпадать для клиента/сервера: `terrain-noise.js`, `ponds.js`, `lakes.js`; чистые высоты отделяются от рендерного `TerrainSystem`. Паритет с `terrain_height.py` не потерять.
- `collision-world.js` уже центрирует формы коллизий, но использует Three.js-объекты как источник части размеров. В core переносим **логические данные объектов** (тип, позиция, примерные габариты). Клиент может строить точные формы, а сервер — **упрощённые прокси** (усреднённые радиусы, коробки/сегменты для стен). Не требовать совпадения контуров клиентской и серверной физики.
- Деревья используют стабильные seed/ID (например `chunkX,chunkZ:index`), HP и флаги felled; **визуальные виды ели/берёзы не должны менять game ID и баланс**.
- Рубка: контакт на 18-м кадре, цель выбирается в момент контакта; не привязывать разрешение попадания напрямую к объекту `THREE.Raycaster`. На сервер передавать игровой удар/направление/действие; сервер проверяет дистанцию, cooldown, состояние, линию видимости.
- При падении дерева длительность `FALL_DURATION = 5 / 1.3`; появление брёвен и серверная доступность `ready_at` должны оставаться синхронизированы. Визуальные staged mesh/звук остаются на клиенте.
- Смерть, голод, восстановление, выносливость, инвентарь, лут, крафт, хранилища и мобы имеют исторические snapshot-форматы и тесты. Старые offline-слоты нельзя просто сбросить.
- В online сохранения сервера и offline-слоты — разные хранилища. Никогда не записывать сетевой мир поверх локального сохранения.
- `/status` не создаёт игрока; `/bots`, MCP/CLI-агенты и P2P host/guest — действующие интерфейсы совместимости.
- Существующее меню не инициализирует Three.js до нажатия «Играть». Не ломать lazy startup, `index_debug.html` и `window.__gameDebug`.

### 1.4. Базовые тесты до изменений (2026-11-05)

- `node --test tests/*.test.mjs`: **682 всего, 672 passed, 9 skipped, 1 failed**.
- Уже существующий сбой: `tests/sound-rules.test.mjs` → “audio layout matches registry” — фактических файлов **52**, ожидалось **51**. Это **baseline defect**, не результат будущего рефакторинга.
- `python3 -m unittest discover -s tests`: **124 passed**.

Любая следующая фаза должна как минимум не добавлять новых регрессий. Исправление исходного audio-failure — отдельная небольшая задача, не повод объявлять весь baseline зелёным.

## 2. Границы пакетов и контрактов

### 2.1. Структура каталогов (цель, не обязательное создание всего в первом PR)

    game-core/
      index.js                 # публичный API, без браузерных импортов
      engine/
        game-engine.js         # step, commands, events, snapshots, lifecycle
        clock.js               # фиксированный тик / игровые таймеры
        rng.js                 # seeded RNG
      world/
        terrain-height.js
        water-height.js
        tree-placement.js
        resources.js
        collision-world.js
      physics/
        player-movement.js
        kinematic-adapter.js
        physics-port.js        # небольшой порт запросов к физике, если нужен
      gameplay/
        inventory.js
        vitals.js
        combat.js
        chopping.js
        building.js
        crafting.js
        storages.js
        death.js
      entities/
        mob-types.js
        mob-world.js
        mob-population.js
        mob-ai.js
      contracts/
        commands.js           # runtime validation / JSDoc
        snapshot.js
        events.js
      tests/                   # headless unit / scenario tests

    game-server/
      package.json
      main.js                 # CLI/config, startup/shutdown
      server.js               # createGameServer, transport lifecycle
      websocket.js
      sessions.js
      tick-runner.js
      persistence.js
      bot-gateway.js          # /bots compatibility
      tests/

    src/
      game-controller/
        game-controller.js    # documented contract
        local-controller.js
        remote-controller.js
      adapters/
        input-adapter.js
        game-presentation.js
        client-physics.js     # локальное предсказание/визуальная ragdoll-физика
      ...                     # текущий Three.js, UI, audio и графика

Это **эскиз логической структуры**. Не создавать десятки пустых файлов ради соответствия дереву. Начинать с вертикального среза и переносить только реально задействованные модули.

### 2.2. Минимальный Game Core API

    createGameEngine({ seed, config, clock, random, physics })
      .addPlayer(playerId, options)
      .removePlayer(playerId)
      .applyCommand(playerId, command)
      .step(fixedDt)
      .getSnapshot(viewerId?, options?)
      .drainEvents()
      .restore(snapshot)
      .dispose()

Контракты (JSDoc/`.d.ts` по желанию на первом этапе):

    PlayerCommand = {
      seq, tick?, kind,
      // movement: forward, side, yaw, pitch?, sprint, jump
      // interaction: kind, targetId?, ray?, payload?
    }

    WorldSnapshot = {
      version, tick, time, seed,
      players, entities, world,
      lastProcessedCommandSeq?
    }

    GameEvent = {
      id, tick, kind, entityId?, actorId?, payload
    }

Все состояния и события — **plain serializable data**, без `THREE.Vector3`, GLB, DOM-node, WebSocket, Rapier-body или ссылок на функции. Не сериализовать целиком весь лес на каждый тик: snapshot поддерживает scope/interest/filter/delta в будущем.

Использовать инъекцию clock/RNG и простых physics-сервисов, не глобальные часы/случайность внутри игровых правил. Тик мира/AI может быть фиксированным (начальный кандидат 30 Hz), рендер независим; **для проверки позиции на сервере не нужен точный покадровый физический тик**. Состояния получают `tick` и единицы времени.

### 2.3. Клиентский GameController API

    createLocalGameController({ seed, save, coreConfig })
    createRemoteGameController({ transport, predictionConfig })

    controller.start()
    controller.update(dt)                # опрос/обработка; НЕ рендер
    controller.dispatch(command)         # единственная mutation entrypoint
    controller.getViewState()             # read-only presentation data
    controller.subscribeEvents(listener)
    controller.save?()                    # только offline
    controller.dispose()

**UI/controls вызывает `controller.dispatch(...)`**, не `physics.moveHorizontal()` / `vitals.damage()` / прямое изменение `ctx.trees`. Для наведения допустим локальный графический raycast, но окончательное действие проверяется core. Вся физика, влияющая на gameplay, проходит через контроллер.

- Local: `dispatch → engine.applyCommand → engine.step → view/events`.
- Remote: `dispatch → command transport → server`; `snapshot → state reconciliation → view/events`.
- Remote movement: клиент двигается **через свой Root Motion и детальные коллизии**, независимо от ответа сервера; сервер проверяет координаты и корректирует только заметные нарушения. **Не требовать одинакового алгоритма движения в браузере и Node**. HP, лут, дерево, крафт, постройки — серверные. Для локальных эффектов сохранить suppression/dedup по event ID.
- `GameController` **не зависит** от `THREE`, DOM или конкретного WebSocket; клиентский motion adapter может использовать `AnimationMixer` и передавать вычисленное смещение контроллеру; `game-presentation` превращает состояния в меши/анимации/HUD.

### 2.4. Физика: приближённый сервер и точный клиент (принятое решение)

**Экспериментальный scope: физика сервера НЕ должна точно повторять клиентскую.** Сервер не загружает Three.js, GLB или графическую геометрию. Он ограничивает только грубые нарушения: невозможную скорость, большие скачки позиции, свободный полёт и прохождение насквозь крупных стен. Небольшие пересечения с деревьями, мебелью и декором считаем допустимой неточностью, а не поводом усложнять код.

- **Core** хранит логические объекты с ID, позицией, типом, размером/базовым радиусом и правилами, но без Mesh/Group/userData.
- **Клиентский адаптер** сохраняет Root Motion, детальные коллизии, ступени, склоны и ragdoll Rapier для качественного визуального движения.
- **Серверный адаптер** строит упрощённые прокси: деревья/камни ≈ окружности или цилиндры с усреднёнными радиусами; стены и большие постройки ≈ прямоугольники, ограничивающие сегменты или простые коробки. Мелкие детали можно вообще игнорировать.
- Проверять не только конечную точку, но и **отрезок от предыдущей принятой позиции до новой** для крупных непроходимых стен, иначе можно пересечь стену одним пакетом.
- Высоты/водные ограничения рассчитывать в core из чистых процедурных правил, но применять разумные допуски к высоте игрока.
- Сервер не симулирует скелетный ragdoll. Если тело или предмет влияет на лут/игровое взаимодействие, хранить достаточную **приблизительную** серверную позицию.
- Для удара, подбора и строительства по-прежнему проверять права на действие, дальность, cooldown, наличие предметов и грубые препятствия. Не нужен точный GPU-raycast.
- **Не писать универсальную абстракцию всей Rapier-физики.** Нужны только простые запросы к логической геометрии и проверка движения.

### 2.5. Root Motion + ограниченное отклонение (принятое решение)

**Клиент управляет фактическим движением через Root Motion; сервер проверяет предложенный результат.** Никаких серверных AnimationMixer, baked кривых и синхронизации фаз шага в этом scope.

1. Клиент немедленно применяет `tickActor → rootDelta → локальные коллизии` и посылает позицию, `seq`, ориентацию и состояние движения (walk/run/jump).
2. Сервер берёт время **из собственного clock**, сравнивает новую позицию с предыдущей принятой и проверяет пределы: ориентировочно `allowedDistance = maxSpeed * elapsed + movementToleranceMeters`. Допуск `d` небольшой, **конфигурируемый**, без требования сантиметровой точности.
3. Ввести настраиваемые параметры, например `movementToleranceMeters`, `maxTeleportDistance`, `speedBurstBudget`, `majorObstacleMargin`. **Числа подобрать по тестам**, а не придумывать константы заранее.
4. Чтобы погрешность не можно было накапливать каждым следующим пакетом, валидировать также **пройденный путь/скорость за окно времени**, использовать ограниченный budget/credit. Одно небольшое отклонение простить, повторяемую прибавку к скорости — ограничить.
5. Проверять пересечение **крупных препятствий** грубыми shapes и допустимую вертикаль. Не требовать совпадения радиусов стволов, детальных боксов мебели и мешей.
6. Если позиция в пределах допуска — **принимать без лишней коррекции**; при грубом нарушении — ограничить/отклонить и отправить позицию сервера. Небольшую коррекцию клиент сглаживает, большие скачки исправляет сразу. Чужие аватары интерполируются.
7. Сервер остаётся авторитетом для принятой позиции и игровых последствий (HP/loot/inventory/world), **но не воспроизводит точную траекторию игрока**. Это осознанно упрощённая модель защиты, не «полная authoritative input simulation».

**DoD физики миграции:** нормальное движение и Root Motion не изменены; допустимые небольшие расхождения не вызывают постоянного rubber-banding; явные телепорты, невозможная скорость, много мелких ускорений и проход сквозь большую стену не принимаются. Небольшое погружение персонажа в дерево допускается.

**Вне scope:** точный паритет коллизий, root-motion curves на сервере, input replay для расчёта движения, профессиональный античит.

### 2.6. Транспорт и протокол

Транспорт — самостоятельная граница, не `GameEngine`.

- На переходный период сохранить JSON-события V1: `hello/welcome`, `/status`, `chat`, `map_ping`, `emote`, `tree_hit/tree_fell`, `box_add/remove`, `mobs_state`, inventory/vitals, `/bots`.
- Выделить совместимый сетевой адаптер. Gameplay-команды и snapshots версионированы; для движения сохраняем сообщения с клиентской позицией `move{x,z,y,...}` + `seq`/ack и состоянием движения. Сервер **проверяет предложенное перемещение**, а не рассчитывает исходную позицию из команд на каждом тике.
- Сохранить WS за PeerJS bridge: `host` и `guest` должны попадать в один авторитетный мир.
- Обязательные меры: максимальный размер пакета (сейчас Python `MAX_MESSAGE=2048`), runtime validation, rate limiting, IDs/ACL, недоверенные действия, обрыв подключения, heartbeat, защиты от replay/out-of-order команд.
- Не начинать с UDP/WebTransport, бинарного протокола, Rust или сложного ECS — это отдельные эксперименты **после** функциональной эквивалентности.

## 3. Карта переноса исходников

| Группа | Конкретные исходники | Операция |
| --- | --- | --- |
| Почти чистые правила | `inventory.js`, `vitals.js`, `status-effects.js`, `mob-world.js`, `mob-population.js`, `mob-ai.js`, `mob-types.js`, `mob-flocking.js`, `mob-steering.js`, `entity-combat.js`, `hen-rules.js` | MOVE/ADAPT в `game-core`, сохранить экспорты/тесты через временные re-export |
| Высоты/размещение/ресурсы | `terrain-noise.js`, `ponds.js`, `lakes.js` (чистые расчёты), `tree-spacing.js`, `resource-zones.js`, `collectible-decor.js`, `log-grid.js`, `fallen-log-layout.js`, `camp-rules.js`, `storage-model.js` | MOVE/ADAPT только чистую часть; рендерные функции/материалы оставить в клиенте |
| Столкновения | `collision-world.js`, `collision-kinematic.js`, `physics.js` | SPLIT: логические габариты в core, клиентская точная кинематика/Root Motion в клиенте, **приближённые серверные прокси и лимиты** в Node adapter. |
| Лес и чанки | `world.js`, `terrain.js`, `world-stream-data.js`, `ground-box-index.js` | SPLIT: логические объекты, deterministic spawn/ID/colliders — core; mesh/streaming/LOD — client |
| Геймплей | `chopping.js`, `building.js`, `crafting.js`, `camp-structures.js`, `storages.js`, `forest-resources.js`, `ground-boxes.js`, `death.js` | SPLIT на commands/rules/state/events и UI/preview/VFX |
| Персонаж | `player.js`, `animations.js`, `fall-damage.js`, `vitals-ui.js` | SPLIT: правила/урон/состояние в core; Root Motion и клиентская кинематика остаются на клиенте, сервер проверяет предложенную позицию приблизительно. |
| Мобы/курицы | `mobs.js`, `mob-ragdoll.js`, `mob-assets.js`, `mob-pose.js` | Core для AI/damage/loot/spawn; client для моделей, skinned poses и декоративной ragdoll |
| Offline | `offline-save.js`, `save-slots.js` | Core для формата/валидации/restore state; browser adapter для localStorage, слотов и UI |
| Multiplayer | `multiplayer.js`, `peer-bridge.js`, `player-list.js` | Сетевой transport/remote controller отдельно; remote avatars, чат и UI остаются в client |
| Чисто visual | `grass.js`, `micro-grass.js`, `tree-instancing.js`, `spruce-*.js`, `birch-*.js`, `atmosphere.js`, `render-profiler.js`, `game-audio.js`, UI/CSS, `world-task-scheduler.js` | **Оставить в `src/`**, не импортировать на сервер |
| Legacy Python | `forest_server.py`, `mob_world.py`, `mob_ai.py`, `mob_definitions.py`, `server_bots.py` и прочие | Использовать как behavioural reference, затем заменить Node adapters. Не удалять до parity |

**Правило для смешанных модулей:** не переносить целиком из-за названия файла. Один класс может содержать и domain logic, и Three.js; разделять функции по зависимости и владению состоянием.

## 4. Backlog реализации

Задачи ниже — небольшие проверяемые изменения, а не один гигантский rewrite. Каждая следующая фаза начинается после зелёных приёмочных тестов предыдущей.

### Фаза A — контракты, baseline и упаковка (P0)

- [ ] **GC-01. Инвентаризация вызовов и владельцев состояния.** Для `ctx` определить все mutable-поля, кто пишет их в offline и online, какие структуры сериализуются. Построить таблицу `input → mutation → effect → save/network` для player, trees, mobs, inventory, buildings. **DoD:** ни один gameplay-writer не остался без владельца/запланированного порта.
- [ ] **GC-02. Зафиксировать baseline и сценарии.** Сохраняемые fixture snapshots (offline + Python world), seeds, типовые команды, инварианты дерева/падения/лут/AI. Зафиксировать текущее расхождение audio test отдельно. **DoD:** воспроизводимые тестовые сценарии до рефакторинга.
- [ ] **GC-03. Подготовить ESM `game-core/` и `game-server/`.** Node `v22` текущей машины; минимальный `package.json` для Node server/WS, без обязательного TS/Vite. Client должен уметь импортировать shared relative ESM со статического хоста. **DoD:** smoke import одного и того же модуля и из Node, и из браузерного entrypoint.
- [ ] **GC-04. Проверка импортных границ.** Автотест, запрещающий в core импорты из `src`/`game-server` и обращение к `window`, `document`, `localStorage`, `THREE`, `WebGLRenderer`, `AudioContext`, DOM, сетевым сокетам. Исключения для серверных/клиентских адаптеров — вне core. **DoD:** headless импорт всех публичных core modules без WebGL/DOM.
- [ ] **GC-05. Согласовать commands, snapshots, events.** Version, tick/seq, единицы времени, IDs, схема ошибок/rejections, сериализация. **DoD:** контрактные fixtures и runtime-валидация входа.

### Фаза B — чистый мир и физический фундамент (P0)

- [ ] **GC-06. Перенести pure utility modules** из таблицы в `game-core`; в старых `src/...` временно оставить re-export, чтобы не ломать десятки относительных импортов/тесты. **DoD:** прежние юнит-тесты проходят без переписывания бизнес-правил.
- [ ] **GC-07. Terrain/Water Logic.** `heightAt`, `waterDepthAt`, seed и правила берега/озёр живут в core. `TerrainSystem` генерирует только графические mesh. **DoD:** паритет с существующими `terrain_height.py` и JS water/terrain tests для набора координат/seed.
- [ ] **GC-08. Logical World Model.** `WorldState`, деревья, ID/HP/felled, камни, брёвна, постройки, ресурсы и структура чанков без mesh, fog/LOD/geometry. **DoD:** создание и изменение мира в Node без Three.js; изменение graphics quality не меняет gameplay entities.
- [ ] **GC-09. Разделить логические габариты и точность коллизий.** Вынести ID/типы/позиции и **примерные** размеры физических объектов из Three.js в модель мира. Клиент сохраняет текущие точные проверки (включая ragdoll), сервер строит приближённые круги/цилиндры/коробки и проверяет крупные стены. **DoD:** Node работает headless, сервер не пропускает через большую стену; небольшие несовпадения с формами дерева/мебели допустимы.
- [ ] **GC-10. GameEngine + тик мира.** Порядок: команды и принятые координаты → игровые правила/AI/таймеры → события/snapshot. Для игровых сущностей фиксированный тик, для перемещения игрока — проверка пришедшей позиции, **без точного воспроизведения Root Motion**. **DoD:** headless мир на Node, повторяемые результаты gameplay rules, разные комнаты независимы.
- [ ] **GC-11. Сохранить Root Motion на клиенте, упростить физику сервера.** Клиент продолжает использовать `tickActor → rootDelta → детальные локальные коллизии`; не менять GLB, веса blend и ощущение движения. Node-сервер получает позицию/seq/режим и проверяет максимальную скорость, время, допуск `movementToleranceMeters`, ограниченный накопительный `speedBurstBudget`, допустимую вертикаль и пересечение крупных препятствий. **Не переносить** на сервер GLB/AnimationMixer, фазы клипов, baked Root Motion curves и точный интегратор ходьбы. **DoD:** малые естественные расхождения принимаются без коррекции, большие скачки/ускорение/проход сквозь стену ограничиваются, клиентский Root Motion не деградирует.
- [ ] **GC-12. Ragdoll ownership.** Определить какие последствия ragdoll (смерть, падение, позиция трупа, loot reach) авторитетны и как реплицируются, а какие являются косметикой. **DoD:** ручное ragdoll/восстановление, падение и смерть не создают неконсистентных позиций и урона.

### Фаза C — Offline через LocalGameController (P0)

- [ ] **GC-13. Создать абстракцию `GameController` и Local implementation.** Управление жизненным циклом симуляции, command, snapshot/events, reset, dispose; интерфейс принимает также рассчитанное клиентом Root Motion смещение/позицию. UI не пишет прямо в core state. **DoD:** тест локального gameplay и движения через контроллер без потери поведения.
- [ ] **GC-14. Распутать `src/player.js` и `src/main.js`.** Вынести сбор input, клиентский Root Motion adapter, controller и presentation loop. Записи в `ctx.px/pz/feetY` ограничить адаптером, ответственным за перенос состояния в Three.js. **DoD:** offline ходьба/прыжок/падение и камера сохраняют поведение; сервер не загружает визуальные анимации.
- [ ] **GC-15. Перенести игровые команды по вертикальным срезам:** (1) chop/tree/drops; (2) pickup/inventory/vitals/death; (3) building/crafting/storages/camp; (4) mobs/AI/loot. Каждый срез переносит **state + rules + event + view update + tests**, а не только helper. **DoD:** каждое действие в offline создаёт core event, UI/звук/VFX подписаны на событие, а не самостоятельно меняют HP/сумку/дерево.
- [ ] **GC-16. Offline save adapters.** `controller.save/restore` сериализует core snapshot; `localStorage`/10 слотов/меню остаются браузерными adapters. Миграция старых форматов/aliases (включая `hens` → `mobs`) без потери прогресса. **DoD:** старые fixtures открываются и повторно сохраняются; онлайн-состояние никогда не записывается в offline slot.
- [ ] **GC-17. Client presentation binding.** Реестр `entityId → mesh/actor`, spawn/despawn/state updates; визуальное падение деревьев, staged logs, эффекты, тени, звук и мобильные controls остаются рабочими. **DoD:** никакая визуальная оптимизация/отключение GPU-эффекта не меняет авторитетные gameplay расчёты.

### Фаза D — новый Game Server на Node.js (P0)

- [ ] **GC-18. Headless Node runtime.** `game-server/main.js`, WS endpoint, config/CLI `host/port/save`, `/status` без регистрации игрока, процесс shutdown/save. Один `GameEngine` на комнату; session-to-player mapping. **DoD:** тестовый Node client подключается, получает welcome/state; сервер стартует без Three.js/DOM/GLB/CDN.
- [ ] **GC-19. Game Server с приблизительной физикой.** Серверный тик выполняет игровые правила; движение принимает после проверки `speed * elapsed + tolerance`, накопленного budget и крупных препятствий. **Не симулировать root phases / точную ходьбу**. Клиентские координаты — предложение на проверку. **DoD:** очевидные телепорты, невозможная скорость, серия небольших превышений и проход через стену отклоняются; малые расхождения допускаются, действия с наградами остаются строго проверяемыми.
- [ ] **GC-20. WS protocol adapter и RemoteGameController.** Вынести `src/multiplayer.js` в transport + command/snapshot handler + presentation UI; подключение, ping, reconnect, disconnect, join/leave, world init. На время миграции возможен V1 compatibility слой для старого Python сервера. **DoD:** client online подключается к Node, а UI не обращается напрямую к игровым socket messages ради gameplay mutations.
- [ ] **GC-21. Лёгкая коррекция и интерполяция.** Клиент применяет Root Motion мгновенно, отправляет позицию с `seq`, сервер подтверждает/отклоняет, клиент корректируется **только при превышении допуска**; чужих игроков интерполировать. Полный replay input-команд для движения не обязателен. **DoD:** playable на 50/100/200 ms и jitter без регулярного rubber-banding.
- [ ] **GC-22. Server game features parity.** Деревья, fall/drop, инвентарь/предметы/ограничения, голод/падение/смерть, postройки/склады, мобы/курицы/AI/loot, чат/пинги/эмоции. Переносить `forest_server.py` по сценариям, не переписывать правила в `game-server`. **DoD:** матрица ниже пройдена в 2 клиентах и через сценарные Node tests.
- [ ] **GC-23. Server save compatibility.** Либо read/migrate существующий `forest_world.json`, либо явная one-time migration с бэкапом и проверкой инвариантов; atomic write + restore на рестарте, TTL и persist cooldowns. **DoD:** Node восстанавливает реальный старый save fixture, не теряет мир при рестарте.
- [ ] **GC-24. P2P bridge и /bots.** Сохранить host/guest/прокси и bot MCP/CLI через совместимый `/bots` либо небольшой gateway к Node runtime. `bot_gateway.py` и внешние клиенты не должны требовать браузер. **DoD:** 2 клиента (direct + P2P) и 1 headless bot в общем мире; токен ботов проверяется.
- [ ] **GC-25. Legacy Python retirement.** Оставить Python-сервер как reference/fallback до прохождения matrix, затем удалить только gameplay-runtime, на который нет внешних зависимостей. Python MCP/CLI для ботов **можно оставить** клиентами Node. **DoD:** документация запуска по умолчанию указывает Node; старые тесты/инструменты пересмотрены, нужные compatibility fixtures сохранены.

### Фаза E — устойчивость, проверки, оптимизация (P1)

- [ ] **GC-26. Snapshot bandwidth + interest management.** Делить authoritative state и presentation state; присылать только актуальные сущности/изменения. Начать с простого spatial filtering по чанкам и периодических полных snapshots. **DoD:** боты вдали не засоряют трафик, входящий клиент корректно получает полное состояние своей области.
- [ ] **GC-27. Server diagnostics.** Avg/p95/p99 tick duration, backlog, packets/sec, bytes/sec, entities, collision checks, active players, dropped commands, reconciliation distance. **DoD:** метрики доступны headless без браузера; фиксированное время обработки тика ниже бюджета в выбранном тестовом профиле.
- [ ] **GC-28. Test bots/load harness.** 1/5/20/50/100/500 симулируемых клиентов, повторяемые действия, сбор профиля нагрузки, память и пропускная способность. **DoD:** измерения сохранены; **500 игроков — экспериментальная цель, не блокер функциональной миграции**.
- [ ] **GC-29. Cleanup и импорты.** Удалить временные facade/re-export и старую бизнес-логику в `src` **только после** замены всех callers; import-boundary scan, архитектурные диаграммы, README и AGENTS.md. **DoD:** нет альтернативного code path, меняющего gameplay state напрямую из client.
- [ ] **GC-30. Опциональный запуск local core в Web Worker** (отдельная оптимизация): если тяжёлый offline core заметно задерживает rAF, вынести его за message interface, сохранив `LocalGameController` API. **DoD:** одинаковые сценарии main-thread/worker, сравнение latency/FPS.

## 5. Матрица приёмки — не пропустить механику

| Область | Offline | Node online | Специальная проверка |
| --- | --- | --- | --- |
| Spawn / movement / jump / sprint / fall | ✓ | ✓ | точные клиентские коллизии, грубые серверные; пересечение мелкой геометрии допустимо, большая стена и телепорт — нет |
| Камера / GLB / root motion / strafing | ✓ | ✓ | Root Motion полностью на клиенте; сервер знает пределы скорости, **не фазы шага**; допустимые отклонения не исправляет |
| Деревья / hit frame 18 / выбор цели / HP | ✓ | ✓ | перевод прицела A→B до контакта, spam/replay |
| Падение дерева / 3 бревна / pickup | ✓ | ✓ | `FALL_DURATION`, staged visual logs, `ready_at` |
| Мобы/курицы: seed, AI, стайность, hit, loot | ✓ | ✓ | flee, corpse, разные виды/окрасы, despawn |
| Голод / stamina / еда / potion / урон / смерть | ✓ | ✓ | переход 0 HP, предметы на земле, отсутствие двойного урона |
| Строительство: брёвна/скамьи/постройки | ✓ | ✓ | коллизии, preview vs authoritative placement |
| Сундуки/стеллажи/слоты/вес | ✓ | ✓ | конкурентные переносы, дедупликация |
| Ресурсы/декор/respawn | ✓ | ✓ | seed, IDs, cooldown, два игрока одновременно |
| Day-cycle, time sync, сохранение | ✓ | ✓ | рестарт, старые save fixtures |
| Multiplayer: connect/join/leave/chat/map/emote | — | ✓ | 2 клиента, P2P relay, reconnect |
| Headless bots /status /bots | — | ✓ | MCP/CLI, токен, лимиты и отсутствие UI |
| Debug / мобильный HUD / minmap / меню | ✓ | ✓ | no regressions, lazy initialization |
| Performance | ✓ | ✓ | physics step, network bytes, отсутствие лишней графики |

Для действий проверять не только финальный snapshot, но и **количество/порядок событий**, чтобы не возникало двойного расхода предметов, двойного звука и дублированных наград.

## 6. Тестирование и контроль миграции

1. **Unit:** существующие `node --test tests/*.test.mjs`, плюс `game-core/tests` на конкретные правила/коллизии и `game-server/tests` на протокол. На период миграции запускать Python tests как эталон поведения.
2. **Contract:** набор JSON fixture `initialState + commands + ticks → expectedState + expectedEvents`. Запускать их в Local и Node Core; при одинаковом начальном состоянии результат должен быть одинаков (с явно оговорёнными допусками для floating point).
3. **Cross-runtime parity:** общие seeds, commands и snapshots **игровых правил** в браузере и Node. **Не требовать одинаковых траекторий или коллизий**: для movement отдельно проверять ограничения сервера и отсутствие постоянных ненужных коррекций.
4. **Networking:** malformed packets, out-of-order/replay, disconnect mid-action, двое игроков подбирают один предмет, одновременный chop, timeouts, bot interactions.
5. **Integration:** три обязательных smoke-набора: offline с save/reload; 2 browser clients + Node server; human + headless bot + P2P guest.
6. **Performance:** записывать baseline по тикам и реальному сетевому трафику. Не предполагать, что TypeScript/Node/JS сами ограничивают 500 игроков без измерений.
7. **Rollout/rollback:** вводить `GameController` за переключателем режима/тестовым запуском. Пока Node parity не пройден — старый Python-сервер остаётся рабочим. После каждого среза проверять, что новый path единственный авторитетный для перенесённой механики.

### Команды baseline

    node --test tests/*.test.mjs
    python3 -m unittest discover -s tests
    python3 -m py_compile forest_server.py server_bots.py bot_gateway.py bot_mcp.py bot_cli.py

Позже добавить, например:

    node --test game-core/tests/*.test.mjs
    node --test game-server/tests/*.test.mjs
    node game-server/main.js --host 127.0.0.1 --port 8765 --save forest_world.json

Эти команды **целевые**; директории/entrypoint ещё не созданы.

## 7. Отдельные решения, чтобы не создать новую сложность

1. **Не переписывать весь проект на TS ради миграции.** Исходники сейчас JS ESM, браузер запускает их без сборщика. Можно усилить JSDoc/type checking позже.
2. **Не делать два Game Core.** Offline и Node используют единые файлы/версии; не дублировать rules в сервере.
3. **Не смешивать authoritative physics и косметическую ragdoll.** Статус/урон/положение gameplay объектов — core, а скелетные кости/GPU — client.
4. **Сохранить текущий Root Motion на клиенте без переноса его на сервер.** Клиент выбирает перемещение из Root-треков; сервер не знает фазы шага, проверяет лишь грубые ограничения скорости и препятствий с настраиваемой погрешностью. Контакт удара на 18-м кадре остаётся клиентским timing; сервер отдельно проверяет игровые ограничения.
5. **Не хранить состояние core в `ctx`/Mesh.** `ctx` на время миграции — адаптер презентации. Все изменения проходят через команды и events.
6. **Не начинать с идеальной сетевой оптимизации.** Сначала функциональная совместимость и authoritative server; затем prediction/interest/delta/load.
7. **Не удалять Python рано.** Он остаётся тестовым эталоном и запасным сервером до прохождения сквозных сценариев.
8. **Не делать архитектуру специально под Rust.** Достаточно сериализуемых данных, чистых API и тестов; дальнейший rewrite когда-нибудь будет возможен, но в этом плане не выполняется.

## 8. Рекомендуемый первый PR / первая задача агенту

**Первым сделать только фундамент, без смены поведения игры.**

- `GC-01..05`: зафиксировать writers/state, команды/snapshots/events, создать каталоги и ESM exports, headless import test.
- Затем один маленький работающий vertical slice: **клиентский Root Motion → LocalGameController и простая серверная валидация предложенной позиции**, пока текущий `src/player.js` продолжает работать через прежний путь.
- Доказать равенство **игровых правил** и ожидаемое прохождение/отклонение движения серверным приближённым валидатором; **не** сравнивать покадровую клиентскую и серверную физику на идентичность.
- Только после этого переключать реальный offline gameplay и делать перенос сложных механик.

**Не писать сразу Node WebSocket-сервер поверх старого `ctx`.** Иначе получим перенос Python-монолита в JS-монолит, а не независимый движок.

## 9. Definition of Done всей миграции

- [ ] Игрок через UI/controls работает только с `GameController`, не изменяет напрямую физическое/игровое состояние.
- [ ] Общие игровые правила и логическое состояние живут в **одном `game-core`**, доступном браузеру и Node без GPU/DOM. Клиентская точная физика и серверный грубый валидатор **намеренно различаются**.
- [ ] Offline работает **без Node-сервера и без сети** с `LocalGameController`.
- [ ] Online использует **Node.js Game Server + тот же Game Core**; сервер принимает/корректирует предложенное движение с ограниченным допуском, грубо проверяет крупные препятствия, авторитетен для HP, inventory, world state и interactions. Он не воспроизводит Root Motion.
- [ ] `RemoteGameController` отправляет позиционные обновления/действия, получает подтверждения и snapshots/events, мягко корректирует собственное движение только при нарушениях, интерполирует остальных игроков. Root Motion остаётся локальным.
- [ ] Существующие gameplay, сохранения, боты, P2P bridge, UI, мобильный режим, графика и debug entrypoint проходят матрицу приёмки.
- [ ] Regression tests не хуже исходного baseline; нет новых регрессий и забытых legacy путей изменения состояния.
- [ ] Документация и команды запуска/тестирования отражают новый default Node server.
- [ ] Рефакторинг выполнен и верифицирован **без обязательного Rust**, без переписывания Three.js и без введения WASM bindings собственного производства.
