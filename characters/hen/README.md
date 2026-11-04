# Hen — Blender character source

**Single authoritative model:** `characters/hen/hen.blend`.

It contains the high-poly source, static 10k LOD, rigged 3k LOD, a 28-bone skeleton, and two Actions at this revision: `Walk` (32 frames / 24 FPS, 0.45 m Root Motion per loop) and the original `Run` (20 frames / 24 FPS, 0.975 m per loop). Select an Action on `Hen_Rig` in Blender's Action Editor.

`characters/hen/scripts/` contains only four original procedural rebuild/reference tools: `generate_realistic_hen.py`, `generate_hen_textures.py`, `build_hen_lod.py` and `rig_hen_3k.py`. **Do not run them against the finished master**; some rebuild temporary scenes. Earlier one-off animation scripts are recoverable from Git history, but their results are already baked into the Blender file.

The `characters/hen/previews/` directory is gitignored and reserved for temporary offline PNG/GIF renders. No preview images are required for Blender or game runtime. Temporary stages live in ignored `characters/hen/work/`; the original GLB references live in `characters/hen/source/`.

Only client-loadable assets belong under `assets/`:
- `assets/models/hen_low_10k.glb` (static)
- `assets/models/hen_low_3k.glb` (static)
- `assets/models/hen_low_3k_walk.glb` (previous Walk-only rig export)
- `assets/models/hen/textures/` (five feather color PNGs: keep these)

The chicken is not yet integrated into Forest Chopper gameplay.
