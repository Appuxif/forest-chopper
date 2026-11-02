# Current model architecture (2026-11-02)

**Important: later supersedes the legacy notes below.** There are precisely
2 canonical body model GLBs, `game/body_male.glb` and `game/body_female.glb`,
for both gameplay and `preview-lite.html`. Both have an independent Action
bank (13 production Actions initially from the same Blender workbench), 53 bones and
integrated face morphs. There are no `lite/body_*.glb` or animation-only GLBs
in the project. Clothes and hair stay in the shared equipment catalog.
Rebuild: `python3 characters/humanoid/build_all_lite.py --bodies-only --jobs 3`.
To override by sex use the Blender Action prefix `male__` or `female__`.

---

# Forest Chopper — Humanoid Lite: handoff для следующего агента

> Статус на 2026-10-31. Этот документ — **описание уже работающей системы, инструкции по воспроизведению и дальнейший план**. Не принимать всё за production-ready: есть визуальные и игровые ограничения.
>
> Репозиторий: открыть корень проекта Forest Chopper.
>
> Git milestones:
> - `f055736` — исходный MakeHuman Humanoid с 92 морфами, анимациями и сменным снаряжением.
> - `fd48f5f` — упрощённые male/female, 3 face presets, оптимизированная геометрия, новые GLB и отдельный редактор.
> - Не выполнять `git reset --hard`, не удалять чужие файлы и не менять `lumberjack/` или игровые JS без прямого запроса.

## 1. Задача и архитектурное решение

Нужен игровой **модульный Humanoid** для Forest Chopper, а не редактор уровня The Sims:

- Мужской и женский базовые персонажи, обе модели с совместимым скелетом.
- 3 подготовленных варианта лица для каждого пола (без runtime-ползунков).
- Сменные причёски, одежда, обувь; позже бороды, шлемы, инструменты, рюкзаки.
- Минимальная кастомизация цветом кожи и волос.
- Одинаковые анимации и точки крепления снаряжения.
- Обычный одетый персонаж около **10 тысяч треугольников** (дополнительные слои могут превысить бюджет).
- Без runtime morph targets. Готовые варианты создаются в **офлайновом Blender build pipeline**.
- Новая система не связана с существующим игровым `lumberjack/lumberjack.glb` до отдельной задачи на интеграцию.

**Важно:** здесь нет генерации анатомического человека «из примитивов» или полного алгоритма процедурной скульптуры. Исходник — готовые лицензированные skinned meshes, после чего параметры **запекаются**, меши упрощаются и модульно собираются в браузере. Это pipeline для генерации игровых вариантов из единой базы.

### Поток данных

```text
MakeHuman-based CC0 GLB (геометрия / UV / веса / морфы / 53 кости / 12 анимаций)
        |
        +--> blender -b -P build_lite.py --kind body --gender male/female [--face ...]
        |        -> gender/face morphs baked into positions
        |        -> remove 92 shape keys
        |        -> remove Teeth/Tongue
        |        -> decimate body, eyes
        |        -> GLB (one skin, 53 bones, 12 animation clips, no morphs)
        |
        +--> blender -b -P build_lite.py --kind gear --gender male/female --asset X.glb
                 -> bake gender shape
                 -> remove shape keys, reduce polygons, slight garment expansion
                 -> GLB (one skin, matching 53 bones, no animations, no morphs)
                          |
                          v
  /lite/*.glb + clothing.json/hair.json -- GLTFLoader --> humanoid-lite.js
                                                       |
                                                       v
                  Avatar root / one 53-bone rig / independent equipped SkinnedMeshes
                                                       |
                                                       v
                       preview-lite.html: controls + WebGL 3D + animation + stats
```

## 2. Исходники и лицензии

Готовые выходные assets (не GPL-код генератора) взяты из
https://github.com/kblood/CharacterCreator (выходные данные на основе MakeHuman).

Проверенный локальный источник лицензирования:
`characters/humanoid/source/LICENSE-NOTES.md`. В нём отдельно сказано, что **сгенерированные GLB** из CC0-источников, соответствующие JSON-каталоги и sidecar-файлы распространяются как CC0-1.0. **Код upstream-проекта под GPL — не копировать** в игру. Локальные `build_lite.py` и `humanoid-lite.js` написаны отдельно.

В `source/` находятся:
- `humanoid-base-animated.cc0.glb` — тело + 53 bone rig + 92 morph targets + 12 клипов.
- `makehuman-base-53bones.cc0.glb`, `makehuman-morph-base.cc0.glb` — базовая и морфируемая версии.
- `clothing_*.glb` — 14 вариантов.
- `hair_*.glb` — 8 вариантов.
- `clothing.json`, `hair.json` — ID, filename, слот, label, дополнительная метаинформация.
- `base_body.joints.json` — совместимость суставов при сильных морфах; для Lite не используется.

**Оригиналы source/ никогда не перезаписывать.** Новые собственные ассеты добавлять с явной информацией о происхождении и лицензии.

## 3. Структура проекта и роли файлов

```text
characters/humanoid/
  README.md                      Общий обзор обеих версий
  AGENT_HANDOFF.md               Этот подробный документ
  source/                        Неизменяемая исходная MakeHuman-библиотека
  humanoid.js                    Старый runtime с морфами (checkpoint f055736)
  preview.html                   Старый редактор с морфами (checkpoint f055736)
  humanoid-workbench.blend       Blender-сцена исходной версии
  build_lite.py                  Офлайновая сборка одного Lite GLB
  build_all_lite.py              Пересборка библиотеки, кэширует готовые файлы
  lite/                          50 GLB: 6 баз + 44 одежды/причёсок
  humanoid-lite.js               Новый модульный runtime без морфов
  preview-lite.html              Новый браузерный 3D-редактор
  humanoid-lite-workbench.blend  Blender-сцена Lite для ручной инспекции
tests/
  test_humanoid_assets.py        QA старой исходной системы
  test_humanoid_lite.py          QA Lite
```

Blender scene names в `humanoid-lite-workbench.blend`:
- `Forest Chopper | HUMANOID LITE` — мужчина, рубашка, джинсы, обувь, волосы; один 53 bone rig.
- `Forest Chopper | HUMANOID WIP` — морфируемый оригинал.
- `Scene` — сохранённая прежняя базовая сцена пользователя.

## 4. Как именно строятся Lite GLB

### Гендер и лицо: morph baking без runtime morph targets

Исходный GLB имеет shape keys `Basis`, `gender_male` / `gender_female`, `face_*` и прочие.

В `build_lite.py` для каждой базовой вершины делается суммирование **дельт вершин**:

```python
result_position = basis_position + sum(
    (target_position - basis_position) * weight
    for target, weight in active_shape_keys
)
```

Параметры:
- `gender_male=0.8` или `gender_female=0.8`.
- `face=default`: без дополнительных дельт.
- `face=angular`: `face_jaw_width_incr=0.42`, `face_nose_length_incr=0.22`, `face_cheekbones_incr=0.20`.
- `face=soft`: `face_jaw_width_decr=0.42`, `face_nose_width_decr=0.25`, `face_lips_incr=0.20`.

После расчёта shape keys полностью удаляются. В игре остаётся **фиксированная геометрия**; 3 лица на пол — это 3 заранее экспортированных GLB. Гендер отдельно запекается и в каждую одежду/причёску, чтобы тот же предмет мог иметь вариант для каждого пола.

**Нюанс:** скелет общий, а экстремальные изменения тела не поддерживаются. Форма тела и лица может отличаться, но 53 bone names/rest matrices должны оставаться совместимыми; вводить новые morphs следует только в offline build с QA одежды и кожи.

### Упрощение геометрии

После baking модификатор `DECIMATE/COLLAPSE` ставится **до Armature** и применяется к rest mesh, с переносом/интерполяцией весов.

Текущие ratio в `build_lite.py`:
- Body: `0.165`.
- Eyes: `0.45`.
- Eyebrows, eyelashes: оставить `1.0` (не упрощать).
- Long-sleeve shirt / T-shirt: `0.45`.
- Hoodie / jacket / trenchcoat: `0.35`.
- Jeans / shorts / skirt: `0.48`.
- Shoes / boots: `0.32`.
- Hair: `0.32`.
- Прочее: `0.50`.

Также удалить mesh `Teeth` и `Tongue` у Lite body: они не видны в игровом режиме без разговора. Для верхней одежды после decimate вершины сдвигаются на `vertex.normal * 0.010` (10 мм), чтобы уменьшить видимые выступы кожи на плечах/воротнике. Это частичное решение, не правильная система скрытия кожи.

Экспорт `bpy.ops.export_scene.gltf` с `export_format='GLB'`, `export_skins=True`; для тела `export_animation_mode='NLA_TRACKS'`, `export_merge_animation='NONE'`, `export_animations=True`. Для отдельной одежды анимации выключены.

Каждая экспортированная база: **ровно 1 skin, 53 bones, 12 отдельных анимаций, 0 morph targets**.
Каждая одежда/причёска: **1 skin, совместимые 53 bones, 0 morphs**.

### Фактические цифры для комплекта

| Компонент | Male, triangles |
|---|---:|
| Base body + глаза + ресницы + брови | 5 891 |
| Shirt | 1 209 |
| Jeans | 821 |
| Shoes | 1 062 |
| Hair short02 | 1 069 |
| **Итого** | **10 052** |

Женский комплект отличается незначительно (~10 051). Толстая куртка поверх рубашки и длинная сложная причёска увеличат число. Бюджет 10k — ориентир **для обычного комплекта без дополнительного слоя**, не жёсткий глобальный лимит.

Готовые файлы: `body_male.glb`, `body_male_angular.glb`, `body_male_soft.glb`, то же для female, и `clothing_shirt_male.glb` и т.д. 6 + (14+8)*2 = **50 GLB**, всего около **29 МиБ** на диске, но браузер загружает только нужные части.

## 5. Как устроен браузерный редактор

Всё реализовано **в одном `preview-lite.html`**, без React и без сборщика. Three.js v0.170 импортируется из esm.sh как ES modules. В браузере должен работать обычный HTTP server (не `file://`).

**UI**: HTML `<aside>` слева, встроенный CSS, поля `<select>` и `<input>`. Справа / на фоне — один WebGL canvas. Контролы:
- Пол `body`: male/female, смена базового GLB.
- `face`: default/angular/soft, смена базового GLB.
- `skin`: материал тела.
- `hair`, `hairColor`.
- `top`, `bottom`, `shoes`, `outerwear`, `underwear`.
- `animation`, `speed`, `skeleton`.
- `copy`: копировать текущую JSON-конфигурацию.
- `stats`: фактическое число треугольников и мешей.

**3D Viewport**: `THREE.WebGLRenderer` с антиалиасингом, ACES Filmic tone mapping, hemisphere + 2 directional lights, падающие тени, пол и сетка, `PerspectiveCamera`, `OrbitControls` для вращения/приближения.

**Где логика**: `preview-lite.html` — только визуализация и state; `humanoid-lite.js` — ассеты, скелет, экипировка, анимации. В браузерном тестировании доступно:
```js
window.humanoidLitePreview = { actor, cfg };
window.humanoidLitePreview.actor.stats();
```

**Когда происходит пересборка:**
- `body` или `face` → `reload()` → новый `createLiteHumanoid(cfg)` → удалить старый root из Three.js Scene → вставить новый actor.
- `hair` или одежда → `actor.equip(slot,id)`, база НЕ пересоздаётся.
- `skin` / `hairColor` → обновляется материал, геометрия не пересоздаётся.
- `animation` → `actor.play(clip)` на `AnimationMixer`.
- Каждый requestAnimationFrame: `actor.update(dt)` и `renderer.render(scene,camera)`.

Таким образом редактор — не отдельный 3D-движок, а **просмотрщик и конфигуратор экспортированных игровых ассетов**.

## 6. Как Three.js собирает одного персонажа из разных GLB

Файл `humanoid-lite.js`:
- `GLTFLoader` и кэши Promise для GLB и JSON, повторные запросы не скачивают тот же файл заново.
- `SkeletonUtils.clone` используется для каждого персонажа, чтобы у нескольких игроков **не было общих Bone object instances**.
- `createLiteHumanoid(options)` загружает подготовленное `body_{gender}_{face}.glb`.
- `LiteHumanoid` находит 53 кости и скелет, создаёт `AnimationMixer`, Equipment socket Object3D в соответствующих костях.
- `actor.equip(slot,id)` находит предмет в `clothing.json`/`hair.json`, загружает `lite/{original_asset_without_ext}_{gender}.glb`, клонирует меш.
- **Критическая часть — rebinding:** извлечь у предмета `SkinnedMesh.skeleton.bones`, сопоставить каждую `bone.name` с `actor.bones.get(name)`; создать `new THREE.Skeleton(mappedBones, clonedBoneInverses)`, выполнить `mesh.bind(skeleton, mesh.bindMatrix.clone())`, добавить в аватар и снять прошлый предмет из слота. Именно так все элементы следуют одному анимированному ригу. Без этого одежда будет двигаться с отдельным импортированным скелетом, а не персонажем.
- `actor.play(name)` включает GLB-клип и плавный crossfade между действиями.
- `actor.update(dt)` вызывает mixer.update.
- `actor.attach('handRight', object, transform)` крепит предмет к кости руки. Другие sockets: `handLeft`, `head`, `chest`, `back`, `waist`.
- `actor.stats()` проходит по текущим `SkinnedMesh` и суммирует triangles по index/positions.

Текущий интерфейс:

```js
import { createLiteHumanoid } from './characters/humanoid/humanoid-lite.js';

const avatar = await createLiteHumanoid({
  body: 'female',
  face: 'soft',
  skin: 'tan',
  hair: 'ponytail01',
  hairColor: '#c08b48',
  top: 'shirt',
  bottom: 'jeans',
  shoes: 'boots'
});

scene.add(avatar.root);
avatar.play('walk');

// На каждом игровом кадре:
avatar.update(deltaSeconds);

// Реальные примеры смены:
await avatar.equip('hair', 'bob01');
await avatar.equip('outerwear', 'jacket');
avatar.unequip('outerwear');
avatar.attach('handRight', axeObject, {position: [0, 0, 0]});
```

## 7. Как повторить сборку с нуля

Пререквизиты: Blender 5.2+ доступен командой `blender`; Python 3; браузер с WebGL; сеть для esm.sh, либо при адаптации заменить CDN на локальный Three.js. Из корня Forest Chopper:

```bash
git status --short
git log -3 --oneline

# Ничего не трогаем в исходной source/ директории.
# Перегенерировать все 50 GLB:
python3 characters/humanoid/build_all_lite.py --jobs 4 --force

# Можно собрать один конкретный файл:
blender -b --factory-startup -t 2 --python-exit-code 1 \
  -P characters/humanoid/build_lite.py -- \
  --kind body --gender male --face angular

blender -b --factory-startup -t 2 --python-exit-code 1 \
  -P characters/humanoid/build_lite.py -- \
  --kind gear --gender female --asset clothing_shirt.glb

# Проверить файлы:
python3 -m unittest discover -s tests -p 'test_humanoid_lite.py' -v
python3 -m unittest discover -s tests -p 'test_humanoid_assets.py' -v

# Локальный просмотр:
python3 -m http.server 8790
```

Открыть:
`http://127.0.0.1:8790/characters/humanoid/preview-lite.html`

**Важно:** `build_all_lite.py` по умолчанию пропускает уже существующие GLB. После изменения параметров decimate/morph/материалов использовать `--force`, иначе можно ошибочно видеть старую сборку.

## 8. Проверка Blender (обязательно для нового ассета)

Открыть `characters/humanoid/humanoid-lite-workbench.blend` в Blender. Смотреть материал, форму и деформации во фронтальном, боковом, заднем и 3/4 ракурсах, в Idle/Walk/Run/Jump.

При добавлении нового предмета:
1. Использовать импортированный GLB исходного gear или редактируемый `.blend`.
2. Проверить, что меш в rest pose совпадает с выбранным male/female body.
3. Перенести/проверить веса к 53-костному контракту, особенно плечи, локти, запястья, колени.
4. Убедиться, что все имена костей совпадают и в итоговом GLB один `skin`.
5. Проверить геометрию без модификаций, затем пробовать Decimate с разумным ratio; не «сжимать» наугад.
6. Запечь нужную гендерную форму, убрать shape keys, сохранить UV/материалы/веса.
7. Проверить в браузере движения всех конечностей и наложение одежды.
8. Внести новый gear `file/id/slot` в каталог, построить male/female variants.
9. Повторить структурные тесты и визуальные screenshots.

**Blender MCP pitfalls:** не менять живую пользовательскую сцену «вслепую»; использовать новую Scene. После `bpy.data.objects.remove(obj)` больше не обращаться к удалённому Python reference (иначе `ReferenceError: StructRNA of type Object has been removed`), использовать `bpy.data.objects.get(name)`. В исходном импорте иногда shape keys оказываются со значениями 1 и NLA включён; для inspect сначала выставить нейтральную позу и нулевые морфы.

## 9. Статус тестов и ограничения (не преувеличивать)

Уже проверено:
- 50 Lite GLB существуют, все совместимы по **именам 53 костей**, без runtime морфов.
- 6 базовых GLB (2 пола × 3 лица), по 12 отдельных animation clips.
- Бюджет дефолтного одетого аватара около 10k.
- Отдельные персонажи имеют разные экземпляры костей, одежда внутри одного персонажа шарит его bone objects.
- Рендер в браузере: одетые male и female, смена снаряжения и клипов, stats работают.
- `test_humanoid_lite.py` — 6 тестов; `test_humanoid_assets.py` — 6 тестов.
- Blender workbench содержит отдельные сцены. Последний Lite workbench просмотрен front/right/3-4.

**Ещё НЕ сделано:**
- Не интегрировано в основной игровой рендер/мультиплеер. Его старый риг существенно отличается от нового. Нельзя просто перезаписать `lumberjack.glb` и ожидать совместимости: см. `.agents/skills/forest-chopper-character-artist/references/ENGINE_CONTRACT.md`.
- Не сделаны beard/hat/weapon/backpack физические модели. Есть только sockets и API.
- Нет полноценного правила `hidesBodyZones` в Lite, несмотря на то что исходные каталоги такие данные содержат. Тело может торчать через одежду (например, при walk/run). 10 мм inflate на отдельных куртках — временный workaround.
- Есть `clothing.json` сведения о конфликтующих слоях, но runtime пока не обрабатывает их; shirt+jacket возможно пересекаются.
- Не проверены все 22 типа предметов в *каждой* анимации визуально. Структурная проверка не заменяет screenshot QA.
- Женский силуэт / прически / скин-материалы требуют художественной оценки; риски texture/clipping.
- Из-за отдельного `SkinnedMesh` на каждый фрагмент у дефолтного персонажа около **10 skinned drawables**, даже при низком tri count. Оптимизация draw calls, текстур и материалов ещё впереди.
- Нет skinning/animation LOD для толпы, автоматического перехода на impostor.
- Не реализовано совпадение имен текущих клипов с игрой: в Lite `idle/walk/run` (lowercase), у старого дровосека `Idle/Walk/Run/Chop2` и другой Root-motion контракт.
- Не гарантирована абсолютная точность оттенка кожи/волос от HTML color input: tint умножается на исходный материал; ручная проверка обязательна.
- Не сделаны универсальные одежда/оружие из произвольного внешнего GLB: нужны ручной rigging/retargeting/fit и проверка лицензии.

## 10. План следующего агента по приоритетам

**P0: сохранить текущую рабочую базу.**
- Прочесть `AGENTS.md`, этот файл, `README.md`, `.agents/skills/forest-chopper-character-artist/SKILL.md`, `ART_DIRECTION.md` и `PIPELINE.md`.
- Сначала проверить `git status --short`; не коммитить случайно пользовательские untracked/modified файлы.
- Прогнать 12 тестов, открыть редактор и Blender. Создать отдельную ветку/коммит для каждой крупной задачи.

**P1: визуальная доводка и совместимость одежды (высший приоритет).**
- Сравнить front/side/3-4 силуэт male/female с крупными thumbnail и на игровой дистанции.
- Проверить Shirt/Jeans/Shoes/Short hair и другие популярные сочетания в Idle/Walk/Run/Jump.
- Исправить body poke-through: использовать заранее подготовленные body-zone masks или удалить невидимые полигоны кожи **по слоту**, вместо грубого inflate.
- Реализовать прозрачные правила layered equipment: конфликты слотов, скрытие закрытой одежды, цветовые варианты, опции предмета.
- Оставить одну armature на персонажа, 53 bone names, без runtime morphs.

**P2: доступная игроку персонализация.**
- Добавить несколько **качественных** стрижек и бород с лицензиями и подходящей топологией.
- Шапка/шлем, ремень, рюкзак; крепить через sockets или единый bone skin.
- Разные цвета рубашек/брюк/ботинок и ограниченные palettes skin/hair/eyes.
- По необходимости ещё 2–3 готовых варианта лица, но запекать их offline.
- Не добавлять ползунки мышц, роста, веса и прочий сложный character creator без отдельного запроса.

**P3: оптимизация производительности.**
- Измерять triangle count *и* скелетные draw calls, время загрузки, texture memory.
- Оптимизировать файл/текстуры/материалы, объединять совместимые статические элементы там, где это не ломает смену одежды.
- Сделать LOD2 ~2–4k для удалённых игроков; возможно упрощать детали пальцев/скелета только при совместимой системе анимации.
- Проверить толпу из нескольких десятков движущихся персонажей в реальном браузере.

**P4: игровая интеграция — только после согласования с пользователем.**
- Изучить `src/animations.js`, `src/player.js`, multiplayer actor code, root motion и old rig contract.
- Создать адаптер для новой системы, не заменять legacy `lumberjack/` без fallback.
- Синхронизировать компактный appearance JSON между игроками (не меши).
- Подключить новое оружие к правой руке, реализовать и протестировать `Chop`/upper-body overlay, проверить звук/эффекты/оружейные анимации отдельно.
- Проверить local player, remote player, бот/NPC, replay/spawn, reconnect, memory disposal.

## 11. Definition of Done для изменений

Любое новое изменение системы засчитывать только если:
1. Исходная версия `f055736` и рабочий Lite snapshot `fd48f5f` доступны для отката.
2. Автотесты проходят; ни один из 50 GLB (или расширенный каталог) не сломан.
3. У всех объектов одного персонажа **один фактический список Bone instances**, а разные персонажи не делят те же Bone objects.
4. Все заявленные анимации работают, нет разорванных суставов, смешения rig rest poses.
5. Скриншоты нескольких ракурсов показывают лицо, руки, одежду/причёски на мужском и женском теле; QA не основывается только на success exit code.
6. Фактический triangle budget и draw-call budget измерены.
7. Указаны конкретные ограничения/дефекты и список затронутых файлов; изменения, не относящиеся к задаче, не включены в коммит.

## 12. Короткая инструкция следующему агенту

> Продолжай **Forest Chopper Humanoid Lite**, см. `characters/humanoid/AGENT_HANDOFF.md`. Сначала изучи commits `f055736` / `fd48f5f`, `characters/humanoid/README.md`, `build_lite.py`, `humanoid-lite.js`, `preview-lite.html`, тесты и текущий git status. Это модульный игровой персонаж ~10k triangles: male/female, 3 готовых лица, 53 bones, 12 animations, сменные skinned одежда/волосы, без runtime морфов. Исходные CC0 GLB — `source/`, пересборка — `build_all_lite.py`, результат — `lite/`. Не интегрируй автоматически в игру и не заменяй `lumberjack.glb`. Сначала улучши визуальную совместимость одежды и скрытие тела под одеждой, проверь анимации в браузере и Blender, запусти unit tests, делай изолированные commits. Никаких персонажей из примитивов; сохрани человеческую анатомию.

### Update (2026-11-01): morph-aligned production rigs

The 50 GLBs in `lite/` now contain male/female-specific rest joints for all
53 bones, baked in `build_lite.py` from `source/base_body.joints.json` using
the same `0.8` gender morph weight as mesh geometry. Do not restore the old
unisex bind positions. No separate preview GLB library remains. Run the two
rig-specific tests in `tests/test_humanoid_lite.py` after any changes to the
skeleton or garment exports. The **single** animation authoring scene is
`animation/humanoid_animation_workbench.blend` (13 shared Actions, including
`Chop`, and the 5-part temporary axe on `hand_r`). Do not generate another
animation `.blend`; version the same file in Git. Male/Female reuse matching
53-bone Actions, with their own baked mesh rest-pose skeletons. The 30 finger
poses from Chop frame 1 are baked into all 12 standard clips in both genders.
