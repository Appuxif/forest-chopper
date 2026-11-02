# Audio assets

Файлы разложены по назначению. В игре используются **логические ID звуков** (например `pickup`, `axe_chop_3`, `hurt_female_20`); их актуальные относительные пути находятся в [`src/sound-rules.js`](../../src/sound-rules.js) (`AUDIO_FILES`). При переносе или добавлении записей обновляйте **только реестр**, не создавайте пути в игровых модулях.

```text
audio/
├── ambience/             # костёр, озеро, лес, птицы, сверчки, деревья
├── footsteps/            # шаги по листве, дереву, камням, грязи, воде
├── chopping/             # axe_chop_1..7 и tree_fall
├── inventory/            # pickup и обратный drop
├── ui/                   # звук чата
├── voices/
│   ├── male/
│   │   ├── hurt/         # 7 реплик
│   │   ├── jump/         # 2 реплики (Jumping Man Sounds)
│   │   └── death/        # 1 реплика
│   └── female/
│       ├── hurt/         # 4 выбранных: 3, 4, 5, 20
│       ├── jump/         # 5 выбранных: 24–28
│       └── death/        # 1 реплика
├── metadata/
│   ├── CHOP_CUTS.json    # точные границы рубки
│   └── VOICE_CUTS.json   # номера/границы реплик
├── ATTRIBUTION.md        # источники и обязательные лицензии
└── README.md
```

## Регенерация

Из корня проекта:

```bash
python3 scripts/prepare_chopping_sounds.py --source /path/to/choppingtree.ogg
python3 scripts/prepare_voice_sounds.py --source-dir /path/to/originals
python3 scripts/prepare_drop_sound.py
```

Для `prepare_voice_sounds.py` нужны пять оригиналов в `--source-dir`, включая `JumpSoundsMan.zip`. Скрипт никогда не возвращает отклонённые женские фрагменты.

Скрипты теперь сохраняют файлы сразу в целевые папки и обновляют `metadata/*.json`. `--output-dir` у скриптов рубки/голосов принимает **корень аудиокаталога**, а не конечную папку.

`ATTRIBUTION.md` обязателен при распространении игры: часть записей имеет лицензии CC BY и CC BY-SA.
