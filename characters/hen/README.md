# Hen — Blender character source

The **authoritative master is `characters/hen/hen.blend`**, containing three LODs, a 28-bone rig and animation Actions.

The source file currently has three Actions: `Walk` (1–33, 24 FPS, 0.45 m Root Motion), `Walk_Fast` (1–21, 24 FPS, 0.975 m), and `Run` (1–13, 24 FPS, 2.0 m / 0.5 s = 4 m/s with flight phases). All are on `Hen_Rig`; choose them in Blender's Action Editor.

The four reference/procedural scripts in `characters/hen/scripts/` are `generate_realistic_hen.py`, `generate_hen_textures.py`, `build_hen_lod.py`, and `rig_hen_3k.py`. They rebuild temporary geometry; do **not** run them on the finished master. Animation Actions are baked in the Blender file, with no separate generation scripts needed.

`characters/hen/previews/` is gitignored: offline PNG/GIF frames are disposable. `characters/hen/work/` is likewise ignored. Game-loadable assets are kept separately under `assets/models/`, including `hen_low_10k.glb`, `hen_low_3k.glb`, the previously exported Walk-only `hen_low_3k_walk.glb`, and the five required feather textures in `assets/models/hen/textures/`.

The chicken is not yet integrated into the game. No new GLBs have been exported.
