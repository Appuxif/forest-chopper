# Forest Chopper — 3 персонажа в одном Blender Workbench

**Рабочий файл:** characters/humanoid/animation/humanoid_animation_workbench.blend

Здесь живут **три независимых рига с одинаковой иерархией 53 костей**,
собственная геометрия и собственный банк анимаций для каждого персонажа.
Общий .blend не означает общий Action: изменение женской анимации НЕ
переписывает мужскую или дровосекову.

## Как переключать male / female / lumberjack

1. Открой humanoid_animation_workbench.blend.
2. **Справа вверху, рядом с выбором Scene**, переключи выпадающий
   список **View Layer** на нужный вариант.
3. В Outliner выбери риг; он находится в коллекции CHARACTER соответствующей модели.
4. Открой снизу **Dope Sheet → Action Editor**.
5. В выпадающем списке Action выбери анимацию с префиксом текущего персонажа.
6. В Pose Mode правь кости и ключевые кадры; Ctrl+S сохраняет общий .blend.

| View Layer | Риг для выбора в Outliner | Actions |
| --- | --- | --- |
| EDIT · male | Humanoid_Rig53 | male__idle, male__run, male__Chop и т. д. |
| EDIT · female | Female_Rig53 | female__idle, female__run, female__Chop и т. д. |
| EDIT · lumberjack | Lumberjack_Rig53 | lumberjack__idle, lumberjack__run, lumberjack__Chop и т. д. |

Каждый View Layer показывает ровно один вариант персонажа.
В Scene можно переключать View Layer сколько угодно — Action другого рига
не изменится.

**Важно:** старые непомеченные Actions (walk, run, Chop) — общие исходные
референсы. Чтобы поправить только женскую ходьбу, редактируй
**female__walk**, а не walk. Preview NLA-треки заглушены (Mute);
если вдруг мешаются разные позы, проверь NLA Editor.

## Топоры и Chop2

- Male: AXE_GRIP · rotate here to adjust handle, коллекция 03 - Axe.
- Female: AXE_GRIP · Female, коллекция Axe · female (reference only).
- Lumberjack: Socket.handRight · Lumberjack, коллекция
  Axe · lumberjack (reference only). Под сокетом лежат оригинальные
  детали Axe blade и Axe handle, уже без старого Armature Modifier.

Все три держатся за кость hand_r (логический socket handRight).

Для старого дровосека: **EDIT · lumberjack → Lumberjack_Rig53 →
Action lumberjack__Chop**. Это ретаргетированная оригинальная Chop2,
но с именем Action как у новой системы (Chop). Топор виден для
ручной коррекции удара. Отдельный AXE_GRIP можно двигать относительно кисти
без переписывания ключей костей.

Для будущего runtime attachment топор вынесен отдельно:
**lumberjack/lumberjack_axe.glb**. В нём два статических меша без скелета
и анимаций. Preview дровосека топор в собственную геометрию не включает.

### Исправление левой кисти (2026-11-05)

В дровосековом риге Lumberjack_Rig53 кость hand_l теперь имеет head
точно на tail кости lowerarm_l. Дочерние кости пальцев сдвинуты вместе
с кистью. Её анимационные ключи пересчитаны относительно lowerarm_l
в системе координат нового 53-костного рига. Исправлена и локальная
привязка исходного меша Lumberjack.Hand L, чтобы ладонь оставалась
в контакте с рукавом. Зазор между суставами в проверенных кадрах
Idle, Walk, Run, Chop, WalkBackward, RunBackward теперь 0 м
(раньше около 0,315 м).

Правка касается только дровосека. Мужской и женский риги не менялись.
Если файл уже открыт в Blender, закрой и открой его заново или выбери
File → Revert (сначала сохрани другие незавершённые правки).

### Соединение обеих стоп (2026-11-05)

В риге Lumberjack_Rig53 обе цепочки calf_l/r → foot_l/r → ball_l/r
выстроены без разрывов: головка foot точно совпадает с концом calf,
головка ball — с концом foot. Исправлены rest-позиции костей, все
индивидуальные Actions дровосека и bind-матрицы ботинок/шнурков.
Ботинки сохраняют 100% вес на foot, а calf управляет ими через parent;
кости ball не влияют на геометрию, поскольку в старой модели
отдельной части носка не было. Подгонка времён/Root Motion НЕ проводилась.

Blender-валидатор проверяет обе цепочки на нескольких кадрах всех
14 Actions. Изменения ограничены Lumberjack; male/female не затронуты.

### Каналы в Action Editor (2026-11-05)

Чтобы дровосек выглядел в Action Editor так же, как male/female, все
его 14 Actions и оба REF_Lumberjack Actions сгруппированы **по кости**:
53 сворачиваемые группы, внутри каждой Location (3), Quaternion Rotation (4)
и Scale (3). При открытии группы по умолчанию свернуты. Ключи, значения
и временные интервалы не менялись — это только интерфейс Blender.

Если после обновления workbench виден старый длинный список, выполни
**File → Revert** или переоткрой файл, чтобы Blender перечитал Actions.

## Происхождение 14 клипов Lumberjack

| Actions с префиксом lumberjack__ | Происхождение |
| --- | --- |
| idle, walk, run, strafe_left, strafe_right, jump, Chop | 7 оригинальных клипов старого дровосека |
| walk_backward, run_backward | Черновики: обратный ход собственных Walk/Run с обратным Root Motion |
| fall, land | Черновики: сегменты старого Jump |
| idle_breathe, idle_fidget, idle_look | Независимые черновики, полученные из старого Idle |

Дополнительно сохранены оригинальные **Death** и альтернативный **Chop**
как отдельные референсные Actions:
- REF_Lumberjack_Death_original
- REF_Lumberjack_Chop_alternative_original

Они не попадают в preview/runtime. Черновые Action имеют Blender property
fc_derived=true и предназначены для ручного улучшения.

**Ограничение старой геометрии:** исходный персонаж был собран из отдельных
жёстко привязанных мешей. На новом скелете присутствуют все 53 кости,
но отдельно смоделированных пальцев у дровосека нет, поэтому вращение
пальцев не деформирует старую единую кисть. Для гибкой кисти и естественного
изгиба позвоночника понадобятся дополнительные геометрия/веса.

### Root Motion для движения назад (2026-11-05)

В Actions **lumberjack__walk_backward** и **lumberjack__run_backward** теперь
записана полноценная горизонтальная Root Motion на кости Root. Траектории
взяты из соответствующих male/female Actions, пересэмплированы по фазе
и начинаются в (0,0) по горизонтали:
- walk_backward: +1,32 м за текущий цикл;
- run_backward: +1,16 м за текущий цикл.

Все шесть перемещающих анимаций Lumberjack (walk, walk_backward, run,
run_backward, strafe_left, strafe_right) по Root Motion теперь совпадают
с male/female: 1,32 м, 1,32 м, 3,40782 м, 1,16 м, 0,60 м, 0,60 м.
Кривые пересэмплированы на кадры дровосека. Стрейфы теперь для всех
трёх моделей занимают 0,875 с в Blender workbench. Экспортированные GLB
имеют 0,866667 с (26 кадров при 30 FPS). Точки анимаций дровосека
перенесены во времени без изменения значений; другие Actions не трогали.
Для ретайминга: match_lumberjack_strafe_timing.py.

Для уже отредактированного workbench используется скрипт
match_lumberjack_root_motion.py, который не пересоздаёт персонажей.

Вертикальная составляющая Root (подпрыгивание), позы всех других костей
и вручную выставленная длительность каждого Action **сохранены**.
Для будущих конвертаций исправлен код в
prepare_lumberjack_workbench.py. Для уже существующего workbench применяй
match_lumberjack_root_motion.py, не пересоздавая сцену.

## Экспорт для проверки

Для дровосека из отредактированного общего workbench:

    blender -b characters/humanoid/animation/humanoid_animation_workbench.blend --python-exit-code 1 --python characters/humanoid/animation/export_lumberjack_preview.py

Результаты:
- characters/humanoid/animation/preview/body_lumberjack_retarget.glb
  (53 кости, 56 мешей тела, 14 собственных анимаций).
- lumberjack/lumberjack_axe.glb (только топор).

Для текущего мужского/женского анимационного банка:

    blender -b characters/humanoid/animation/humanoid_animation_workbench.blend --python-exit-code 1 --python characters/humanoid/animation/export_animation_bank.py -- /tmp/forest-chopper-animations.glb

Экспортёр мужского и женского банков собирает исходные Actions и
независимые male__ / female__ overrides, а отдельные lumberjack__ и REF_
исключает. Далее build_game_bodies.py выбирает нужный Action для каждого
персонажа. Этот шаг не меняет исходный workbench.

## Не сделано сейчас — запланировано отдельно

- **Нормализация времён анимаций, точек контакта, Root Motion и расстояний.**
  Preview пока сохраняет движения оригинального Lumberjack.
- Переключение трёх runtime GLB через **единый игровой загрузчик**.
  Живая игра по-прежнему использует старый lumberjack.glb.
- Ручная визуальная доводка черновых клипов и весов новых суставов.
  Старому персонажу всё ещё потребуется работа с skin weights.

Скрипт prepare_lumberjack_workbench.py — для **однократной конвертации**
чистого workbench. **Не запускай его повторно на уже подготовленном файле.**
Все последующие правки делаются напрямую в одном .blend и сохраняются Ctrl+S.

Резервная копия исходного .blend:
~/.local/share/forest-chopper/blender-backups/humanoid_animation_workbench_before_lumberjack_20261105.blend
