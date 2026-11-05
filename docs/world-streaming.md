# World streaming (Forest Chopper)

> Карта реализации; сверено с кодом 2026-11-04. Общий жизненный цикл —
> [ARCHITECTURE.md](ARCHITECTURE.md); список механик —
> [GAME_MECHANICS_CATALOG.md](GAME_MECHANICS_CATALOG.md).
> Значения параметров могут меняться с пресетами в
> `src/performance-presets.js`; не считать эти числа неизменным геймдизайном.

Modules: src/world-task-scheduler.js, src/world-stream-worker.js,
src/world-stream-data.js, src/terrain.js, src/distant-forest.js,
src/micro-grass.js, src/world.js, src/world-startup.js.

## Architecture

- Two module Web Workers prepare immutable terrain height grids, seeded
  distant-tree records and grass records. Worker output is packed in typed
  arrays transferred without copying; дальний лес использует точные
  `Float64Array`-координаты для совпадения с seed-детерминированными ID. Workers never import or mutate THREE objects.
- WorldTaskScheduler: fixed priorities collision, near, visible, background,
  prefetch; bounded worker concurrency; per-key revisions; generation
  invalidation; cancellation; apply up to 2 results / 2ms per render tick.
  This is a fixed budget, not a frame-time-adaptive scheduler.
- Worker failures / unavailable Workers fall back to incrementally preparing one
  task per tick on main thread.
- Terrain keeps synchronous exact analytic heightAt for physics and server
  parity. Workers generate vertex-height grids with an extra border for matching
  normals. Only the tile under the player is a synchronous cold-start build.
- Far forest stores source records per 24m chunk (x,y,z,height,scale,species,
  candidate ID), but renders in independent 96m GPU-instance sectors
  (4x4 tree chunks). Each sector uses reused instance buffers and independent
  frustum culling. Turning the camera no longer repacks the entire forest.
- Micro-grass has two tile LODs. Worker records include sampled terrain
  height so the main thread only applies transforms and colors. Density is
  selected per blade using stable world-space priorities, with a configurable
  full-density distance, far-density floor and curve. CPU instance-count
  culling uses the nearest page edge as a conservative bound; the shader
  decides individual visibility, avoiding whole-page density jumps. Far blades
  can widen with distance. Presets in `performance-presets.js` configure these
  values; regression coverage is in `tests/micro-grass.test.mjs`.
- Классическая трава в пучках сохраняет потоковый формат записей
  (9 float/инстанс: x, y, z, yaw, scale, tint, biome, patchKind, patchWeight).
  Worker создаёт world-space Voronoi и микрогруппы корней, но **не** новую
  форму травинок. `classic-grass-clump-geometry.js` объединяет `N` экземпляров
  оригинальной `makeTuftGeometry` в одну геометрию пучка: 6 треугольников
  на травинку near, 4 far. Сам материал остался прежним `MeshLambertMaterial`
  с обычными направлением, цветом, приоритетами и near/far dithering.
  Все старые CPU/GPU коэффициенты прореживания и кеши используются без
  дополнительной степенной/геометрической формулы; пучковая плотность
  означает количество **травинок**, а не количество инстансов.
  Ползунки экспериментального наклона/пригибания не влияют на этот профиль.
- Чёрное рельефное покрытие — третий выбор наряду с micrograss/forest.
  `black-soil-texture.js` один раз генерирует периодическую цветовую карту
  и grayscale bump map (512px) с mipmaps, без новых mesh/draw calls.
  Материал остаётся `MeshLambertMaterial`, карта высоты активируется только
  на этом покрытии. Общие UV-координаты, tiling, sand/shore masks и
  декоративное затемнение грунта сохранены.
- LRU budgets: terrain grids 32MiB, far-forest records 24MiB, grass records
  20MiB, plus up to one inactive tree-model preset capped at 96MiB. Grass
  keeps its existing limited GPU-mesh pool.
- Terrain performs one-chunk lookahead in the movement direction and far-forest
  jobs prioritize chunks ahead of the player.
- No change to world seed, placement algorithms, multiplayer IDs, tree HP,
  inventory or save formats.

## Initial world readiness (main-menu transition)

- Пока открыто главное меню, **нет** Three.js/WebGL и активных world-workers.
- После `main-menu.js` → `import(main.js)` игра начинает рендерить под
  экраном `#load`. `controls.js` не удаляет его сразу.
- `src/world-startup.js` отслеживает ближайший рельеф (3×3), подробные
  чанки деревьев (обычно 5×5), завершение стартовой травы и первую
  партию (до 24) чанков дальнего леса. На Low подробный радиус меньше.
- `createWorldStartupGate` открывает сцену **не раньше 3 секунд**,
  после устойчивой готовности (350 мс); **не позже 5 секунд** от
  начала рендеринга, даже если отдельный worker не успел.
- Онлайн дополнительно ожидает `welcome` / `isOnline`; по тайм-ауту
  показываются доступные средства переподключения.
- Дальние чанки могут продолжить догружаться после перехода; это
  допустимая экономия времени старта, не блокировка всей карты.

Ключевые регрессионные тесты: `tests/world-startup.test.mjs`,
`tests/distant-forest.test.mjs`, `tests/world-streaming.test.mjs`.

## Manual acceptance scenarios (remaining)

1. Walk and sprint across 24m/96m chunk boundaries; look for holes or delayed
   terrain, trees and grass; compare frame stability with the preceding build.
2. Turn camera 180 degrees repeatedly by a lake; confirm that frustum-culled
   sectors do not flicker and opposite-shore trees still appear on High/Ultra.
3. Move away from a lake and return; observe faster warm-cache loading and
   stable tree/tree-resource IDs.
4. Switch High -> Low -> Ultra and change seed; ensure obsolete worker results
   never reappear, ground seams remain invisible, and model visuals refresh.
5. Try integrated GPU/mobile and multiplayer; compare both peak FPS and
   noticeable frame-time stalls.

The detailed near-forest Three.js object construction remains incremental on
the main thread, as required by collision and interaction objects. Profiling
and adaptive frame-time budgets are intentionally deferred.

## Наземный лут / AOI (2026-11-01)
- Box spatial grid 24×24 м: клиент индексирует отдельно каждую обычную коробку и каждый из оставшихся сегментов поваленного дерева.
- Один textured instanced batch на тип геометрии на активный чанк; чанки за пределами видимости освобождают WebGL-объекты, но не логические данные.
- TTL каждого бокса отслеживается min-heap, без полного сканирования списка на каждом кадре.
- Multiplayer: серверный BoxRegistry (spatial hash + heap) и радиус подписки 120 м, обновление при смещении 12 м. Welcome не содержит полный массив лута удалённых чанков; вновь появившиеся коробки получают только релевантные клиенты. Это защищает WebSocket-трафик и предотвращает передачу тысяч неактуальных объектов на клиенте.
