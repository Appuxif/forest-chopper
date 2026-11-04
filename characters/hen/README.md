# Hen — character source

The **authoritative file is [hen.blend](./hen.blend)**. It holds all geometry, materials, skeleton and animation Actions. Editing an existing Action does **not** require creating a new Python script, another `.blend`, or a new GLB.

## Contents

```text
characters/hen/
  hen.blend                # Blender master, all six Actions
  hen_colors.json          # Recoloring manifest
  scripts/
    generate_realistic_hen.py   # Original procedural high-poly generator
    generate_hen_textures.py    # Produces five client feather textures
    build_hen_lod.py            # High-poly -> static LOD 10k and 3k
    rig_hen_3k.py               # Original rig/skin-building recipe
  previews/                # Local generated renders only; gitignored
  work/                    # Temporary build files; gitignored
  source/                  # Original/reference GLB files

assets/models/
  hen_low_10k.glb          # Static 9,964-triangle model
  hen_low_3k.glb           # Static 2,964-triangle model
  hen_low_3k_walk.glb      # Earlier Walk-only skinned GLB
  hen/textures/            # Client-facing feather PNGs
```

The client does not load anything from `characters/hen/`. **Runtime textures under `assets/models/hen/textures/` are required** and must not be mistaken for disposable preview PNGs.

The four scripts are optional procedural **rebuild/reference tools**. In particular, the high-poly generator starts from a clean scene, and LOD/rig scripts operate on temporary files inside `work/`. **Do not run them on the finished `hen.blend`.** They don't reproduce the latest six animation Actions. Previous animation experiments, one-off fixes and preview scripts are recoverable from Git history if ever needed, rather than kept in the active source tree.

Temporary PNGs/GIFs can be rendered into `previews/` when reviewing animations; they are **not committed**. Previews are not needed to animate the character in Blender. The authoritative output is the `.blend`.

## Animation Actions

Select `Hen_Rig` in Blender, choose an Action in the Dope Sheet's **Action Editor**, set the timeline end to the action's end frame, and press Space.

| Action | Frames | FPS | Root Motion |
| --- | --- | --- | --- |
| `Walk` | 1–33 | 24 | 0.450 m/cycle (~0.34 m/s) |
| `Walk_Fast` | 1–21 | 24 | 0.975 m/cycle (~1.17 m/s) |
| `Run` | 1–13 | 24 | 2.0 m/cycle (4.0 m/s), with flight phase |
| `Idle` | 1–73 | 24 | None; quiet breathing, subtle head/tail motion |
| `Peck` | 1–73 | 24 | None; three irregular hip-assisted pecks with slightly spread wings |
| `Sit` | 1–73 | 24 | None; relaxed seated loop, body slightly reclined, legs tucked beneath thighs, low tail |

All six Actions belong to the same 28-bone rig, with Fake User enabled, and all survive saving/reopening the single master project. `Sit` is an already-seated idle loop, **not** a sit-down transition.

The master has three LOD collections: 514,936-triangle high-poly source, 9,964-triangle static LOD, and 2,964-triangle rigged LOD. Only the last is animated. The model has one recolorable feather atlas and five variants (russet, white, black, golden and speckled).

**Root Motion:** Blender forward is −Y; exported glTF forward is +Z. The game should extract the horizontal `Root.position` track to move the character and cancel the visible root displacement before applying the pose, avoiding double movement/foot skating.

## Game integration status

Chicken assets are **not yet integrated into Forest Chopper gameplay**. The GLBs in `assets/models/` are previous exports; `Walk_Fast`, the current `Run`, `Idle`, `Peck` and `Sit` have **not** been exported to GLB yet. Export only when integrating the animal into the game.
