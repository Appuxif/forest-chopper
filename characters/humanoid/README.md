# Forest Chopper — modular anatomical Humanoid (WIP)

**This is a new character system, not a rework of the game's legacy lumberjack.**
The previous procedural Rowan character was deleted. The production
`characters/lumberjack/lumberjack.blend`, `lumberjack/lumberjack.glb`, and JS loader are unchanged.

## Live editable Blender scene

`humanoid-workbench.blend` — open in Blender 5.2+. Also opened in the currently connected Blender as `Forest Chopper | HUMANOID WIP`.

- One anatomically proportioned **human body**, independently sculpted upstream by MakeHuman rather than generated from spheres/cylinders.
- Single **53-joint** rig with pelvis, spine, clavicles, shoulders, elbows, wrists, hands,
  **all 30 finger joints** (five fingers with three bones on each hand), legs, feet/toes, neck and head.
- **92 blend shapes** for gender, muscle, body mass, height, face proportions and expression targets.
- Independently skinned **shirt, jeans, shoes, short hair**, all transferred onto **the same armature**.
- Six named empty equipment anchors: hands, head, back, chest, waist.
- Twelve reusable upstream animation actions, including Idle, Walk, Run, Jump and strafes.
- The **original Blender scene remains separately available**. `humanoid-workbench.blend` stores both scenes; its new Humanoid scene is the active one.

## Interactive modular generator

Serve the project root:

```bash
python3 -m http.server 8790
```

Open `http://localhost:8790/characters/humanoid/preview.html`.

This uses `humanoid.js` which creates multiple independent humanoid rigs via `SkeletonUtils.clone`,
loads and re-binds all equipped `SkinnedMesh` assets to **one avatar's 53 matching bones**,
synchronizes morph weights across body + clothing/hair, and hides covered body polygons by
the source asset's `_CCZONE` bitmask. **No special game bundle/build system is required.**

The included library has **14 clothing pieces** in six slots
(underwear, bra, top, bottom, shoes, outerwear) and **8 hairstyles**.
The UI exposes core visible slots and lets you change body archetype, weight, muscles, height,
hair, outerwear and the animation clip. The full JavaScript API also supports underwear/bra.

```js
import { createHumanoid } from './characters/humanoid/humanoid.js';

const player=await createHumanoid({
  preset:'male',
  top:'shirt', bottom:'jeans', shoes:'shoes', hair:'short02'
});
scene.add(player.root);
player.play('walk');                     // 12 named glTF clips available
player.update(dt);                        // call every render/physics tick
await player.equip('outerwear','jacket'); // update and rebind on the same skeleton
await player.equip('hair','long01');
await player.setMorphs({gender_male:.8,muscle_max:.25});
// For a GLB/Three.Object3D axe, sword, helmet or backpack:
player.attach('rightHand',weaponObject,{
  position:[0,-.1,0], rotation:[0,0,0]  // fine-tune relative to hand bone
});
```

## Current tradeoffs and next tasks

- A substantial baseline (body 26,756 triangles; complete clothed avatar ~36k triangles
  after body-zone masking) — **not yet multiplayer optimized**; add skeletal/geometry LOD,
  texture atlases, garment pooling and GPU-driven crowd LOD.
- Body morphed vertices and garment morphs match, but the **53 joint rest positions
  are not yet recalculated from `base_body.joints.json`**. Large changes to stature,
  limb lengths or body type need rest bind matrices + joint-offset correction.
  Do not assume extreme sliders deform flawlessly before that work.
- Upstream animation is included as a starting library, not a final animation system.
  No chopping/crafting animation, hand-IK weapon grip, retargeted Mixamo/Rokoko actions,
  procedural locomotion foot IK, or game integration yet.
- No beard/helmet/axe content was sourced or created. The bones and attachment sockets
  are provided so equipment models can be added separately.
- All equipment GLBs have the same bind skeleton; **arbitrary third-party clothing
  does not automatically fit**. It must be skinned/retargeted to the 53-bone contract
  and ideally implement the same 92 morph targets and zone-masking conventions.
- Current browser demo is a prototype. Browser validation shows the GLB loads,
  materials render and rig-cloned clothes share bones with the avatar.

## Source and licensing

Anatomical mesh, skeleton, skinning, morphs, animation clips, garment geometry,
materials and hairstyles are from the *generated asset output* of:

- https://github.com/kblood/CharacterCreator
- https://github.com/kblood/CharacterCreator/blob/master/LICENSE-NOTES.md

Its `output/*.glb`, catalogs and joint sidecars are **CC0-1.0** per that repository's
licensing decision. **Do not copy its GPL-3.0 JavaScript/Python build or runtime code**:
the local `humanoid.js` is independently authored code using normal Three.js APIs.
The source models are derivatives of the CC0 MakeHuman system asset pack,
not from any existing Forest Chopper player model.

Important: only source asset data from the CC0 outputs was imported. Licensing
was checked against the upstream `LICENSE-NOTES.md` bundled in `source/`.

## QA

```bash
python3 -m unittest discover -s tests -p 'test_humanoid_assets.py' -v
```

Tests confirm 53 matching bones, complete finger skeleton, 92 shape targets,
catalog asset file availability and compatibility, animation targets, and
presence of the editable Blender workbench.


## Lite modular system — intended indie-game version (post-checkpoint)

The original system above is retained verbatim under Git checkpoint **f055736**.
The lightweight system is separate, with pre-baked meshes and **zero runtime morph targets**.

- `humanoid-lite-workbench.blend`: editable Blender inspection scene, with one male
  humanoid and independently removable shirt, jeans, shoes, hair on a single 53-bone rig.
  This is currently also open in the connected Blender in scene
  **Forest Chopper | HUMANOID LITE**. The earlier WIP scene remains in the blend.
- `lite/body_male.glb`, `lite/body_female.glb`: fixed anatomy + face,
  no morph targets, but all 12 original clips and the full 53-bone humanoid rig.
- `lite/body_{gender}_{angular,soft}.glb`: two optional **pre-baked face presets**
  for each body, sharing the same rig/animations. Three face variants per body total.
- `lite/clothing_*_{gender}.glb`, `lite/hair_*_{gender}.glb`: skinned gear
  exported individually for both genders (44 files).
- `humanoid-lite.js`: asset composer and attachment API. All equipped SkinnedMeshes
  share the actual avatar's 53 bones; no runtime shape keys or independent cloth rigs.
- `preview-lite.html`: 3D test page for body, face, skin tone, hair, hair color,
  clothes, animations and skeleton overlay.
- `build_lite.py`, `build_all_lite.py`: reproducible source-driven CC0 asset
  processing. The original upstream assets remain untouched in `source/`.

From the project root:

```bash
python3 -m http.server 8790
# open http://127.0.0.1:8790/characters/humanoid/preview-lite.html
python3 characters/humanoid/build_all_lite.py --jobs 4 # cached skips existing
# optionally: --force
python3 -m unittest discover -s tests -p test_humanoid_lite.py -v
```

Use this API in the standalone Three.js scene (not yet plugged into the
existing game character loader):

```js
import { createLiteHumanoid } from './characters/humanoid/humanoid-lite.js';
const player=await createLiteHumanoid({
  body:'male',face:'angular',skin:'tan',hair:'short04',
  hairColor:'#d5c097',top:'shirt',bottom:'jeans',shoes:'boots'
});
scene.add(player.root);
player.play('walk');
player.update(dt);
await player.equip('outerwear','jacket'); // independent SkinnedMesh, shared rig
const axe=player.attach('handRight',axeObject,{position:[0,0,0]});
// Other sockets: handLeft, head, chest, back, waist
```

### Observed geometry (not estimates)

| Avatar | Triangles |
| --- | ---: |
| Male default base (body, eyes, eyebrows, eyelashes) | 5,891 |
| Female default base | 5,892 |
| Long-sleeve shirt (male, with skinned opening linings) | 1,553 |
| Jeans (male) | 821 |
| Shoes (male) | 1,062 |
| Short hair 02 (male) | 1,069 |
| **Dressed default male** | **10,396** |
| **Dressed default female** | **10,373** |

Actual counts depend on equipped items; a second jacket, long hair or other
layers can push beyond 10k. The 10k target refers to one ordinary clothed
avatar without extra layers. A two-layer outfit can reach ~11–12k.

### Continuous skin under clothing (replaces coarse triangle culling)

Earlier versions removed entire body triangles beneath clothes. This created
genuine open holes: empty interiors when looking from below shirts, along the
neck opening, cuffs, and the edges of shorts and trousers.

`body-zones.js` now classifies the body by skinning weights once, and computes
a gentle *inward offset* (maximum 3.2 cm) of the **covered skin vertices** when
equipment changes. It blends to zero at neck/face/hands, shirt collar/hem, and
the boundary of short trousers. The body remains a continuous, closed mesh:
**no triangle or index is removed, no bone or morph is changed**. The two
genders and all presets share this process; each actor owns its geometry.

Cloth materials render both front and back sides, so you can see the fabric's
interior from under a shirt or inside a sleeve. Basic shirt/T-shirt torso
geometry is also drawn roughly 1 cm closer, without tightening the shoulders.
Removing items restores the original unmodified skin geometry and normals.

The ordinary dressed male has **10,052 rendered triangles** again (versus
7,484 with the previous hole-producing culling). This is a deliberate quality
trade-off: no new SkinnedMesh or draw call, just the original body surface.
This operation runs only when changing clothes, not every animation frame.

```bash
node --test tests/body-zones.test.mjs
```

The body is continuous, but the imported MakeHuman garments also have
**open cloth edges**. For long-sleeve shirts and T-shirts, `seal_openings.py`
now **bakes skinned inside fabric bridges** from the collar, wrist cuffs and
bottom hem to the nearest body surface. These additions are UV-textured,
weighted to the same 53-bone skeleton and baked into each gender-specific
clothing GLB. The long shirt gains ~320–344 triangles, without new mesh draw
calls. On the runtime material, very subtle textured emissive bounce light
prevents the interior bridge from looking like an unlit black void.

To regenerate, build `body_male.glb` and `body_female.glb` first, since the
seam baker projects toward their body surfaces. `build_all_lite.py --force`
respects this dependency by staging the builds. The source CC0 GLBs are not
modified.

This is still an indie-game fix rather than a hand-tailored garment. These
open models may need topology corrections for exact watertightness around all
UV seams, and layering two garments may still intersect.

Notes: The Blender process first bakes the selected body/face profile to mesh,
then **removes all 92 shape keys**, then selectively decimates the source
geometry. Clothing is decimated and slightly expanded at the surface to reduce
visible shoulder skin pokes. Material texture maps/UV and the bone weights
remain in the exported GLB. All source GLBs are retained as a quality fallback.

### Limits / follow-up work

- The asset remains fairly realistic; art-direction stylization can be added
  with clothes, custom hairstyles, hats, beard and texture palette.
- Face options are whole pre-baked variants, not separate movable facial parts.
- Bone transforms remain on a common MakeHuman rest skeleton for both genders;
  large additional body-shape changes are deliberately out of scope.
- Rigid gear sockets are supported but **no actual weapon, headwear or beard mesh**
  is included yet. They will need modeled or licensed source assets.
- 53 bones and 10 skinned drawables per visible avatar are still meaningful
  costs for a crowded multiplayer scene; plan instancing impostors,
  texture/material batching and distant LOD as needed.
- Animations are inherited from the upstream source. They have not been
  upgraded with foot IK, weapon grip IK or chopping clips.
- The source idle clip pulls the narrower female avatar's wrists against its
  hips. The lite runtime adds a small *gender-specific shoulder pose correction*
  after animation playback (0.17 rad for idle, reduced for locomotion, disabled
  for jumps/falls). This is a skeleton pose adjustment, **not a morph**. It
  restores the uncorrected rotation before every mixer tick, including when
  animation playback is paused, preventing cumulative shoulder drift.
- Not yet integrated into the production player / multiplayer code. The old
  `lumberjack.glb` loader is unchanged.

## Experimental skin-mask checkboxes (isolated clothing worktree)

The standalone `preview-lite.html` contains a **skin mask debug panel** below
Equipment. You can hide/show nine anatomical regions (torso/pelvis, head, neck,
upper arms/shoulders, forearms, hands including fingers, thighs, calves and feet)
without changing clothing or the 53-bone armature. The head option also hides
separately skinned eye parts and the currently equipped hair to avoid floating
facial meshes. A separate checkbox temporarily hides garments to inspect the
cut boundaries on the naked body, without unequipping anything.

`skin-mask-debug.js` classifies the original body triangles once using the
weights of their bones, and rebuilds the **body index buffer only**. It clones
the body geometry for every actor before doing so: no GLB source asset or
another avatar is modified. There is no new mesh and no runtime morphing.

This is an intentionally **coarse visualization tool**. The bone-region edges
may be jagged or remove too much/little skin at collars, elbows and cuffs.
Do NOT interpret it as a finished clothing mask. Fine-grained triangle or
coordinate overrides can be added after reviewing visible results.

- **Показать всё** / **Скрыть всё**: clear/select all mask zones.
- **Скрыть одежду для проверки маски**: inspect cut edges with garments
  temporarily invisible, but keep the actual outfit selected.
- **Запомнить для комплекта**: store the selected mask in this browser's
  `localStorage`, keyed by gender, face, top, bottom, shoes, and outerwear.
  Saved masks restore on selecting the same combination later.
- **Копировать JSON**: copy a portable record of outfit + hidden skin regions
  for later conversion into a per-item clothing mask matrix.

Run `node --test tests/skin-mask-debug.test.mjs` for the mask classification,
reversibility, and head-attachment regression tests.

## UV skin-mask painting in the standalone editor

Use **Рисование точной маски (UV)** in `preview-lite.html` to paint directly on
the animated, skinned human instead of hiding whole triangles by bone group.
The mask is a **1024×1024 pixel CanvasTexture** used as a `MeshStandardMaterial`
`alphaMap` with `alphaTest=0.5` and `alphaToCoverage=true`.

- Enable **Рисовать на персонаже**; the editor temporarily hides garments,
  reveals all coarsely hidden body triangles, and pauses the current pose.
- Left-click/drag over skin to **Скрыть кожу** (paint black). Switch to **Вернуть
  кожу** (white) to erase the hidden region. Change the UV-space brush radius.
- Disable painting to rotate/zoom and check how the cut looks *with clothes*.
  Animations resume at the selected speed.
- **Отменить мазок** keeps up to eight stroke snapshots; **Очистить маску**
  restores fully visible skin.
- **Сохранить кисть** stores an independent PNG data URL in browser
  `localStorage`, keyed by gender, face, top, bottom, shoes, outerwear; painted
  strokes are also saved when released. **Скачать PNG** exports a standalone
  mask and **Загрузить PNG** imports a 1024×1024 mask.
- The small checker canvas shows the actual UV mask in black/white. Original
  color textures and source GLBs are never edited; no geometry is subdivided.
  The older coarse anatomy checkboxes remain as separate, optional controls.

**Limitations:** Pixel/UV painting creates smooth cut contours, but it does not
seal the cut 3D shell, fit garments, or make additional flesh where a sleeve
opening is too loose. UV islands contain seams, and strokes crossing UV-island
boundaries may need painting from both sides. `alphaMap` affects only the Body
mesh; eyes/hair are independent, so use the existing **Голова** checkbox to
hide the whole head if required. This is a visual QA tool, not a completed
wardrobe production pipeline.

Tests: `node --test tests/skin-mask-debug.test.mjs tests/skin-paint-math.test.mjs`.
Browser-checked: mouse painting, mask restoration on reload, independent outfit
keys, toggling painting/orbit controls, and alpha-mapped visible skin.

## Local PNG library and clothing-mask matrix (v1)

`preview-lite.html` loads the mask list from `masks/manifest.json` and each
`masks/<gender>/<name>.png` when the page opens. The repository PNGs are the
baseline; masks saved or edited in the browser are local overrides until
exported. The list marks repository files with a folder icon, and these files
must be removed from the repository manually rather than from a browser button.

The **Матрица одежды** panel assigns any number of reusable base masks to a
specific clothing item, separately for male and female. Selecting an item in
the matrix also equips it for immediate visual review. When **Автоматически
применять матрицу** is checked, the viewer uses the union of the mask sets for
all currently equipped items; switch it off to use the manual mask checkboxes.

Assignments are saved automatically to browser `localStorage` while working.
Use **Скачать JSON матрицы** and replace
`characters/humanoid/masks/clothing-matrix.json` to commit them to Git. The
**Взять из проекта** button discards the browser assignments and reloads that
JSON from the project. Likewise, edited/new masks must be exported via
**Скачать архив ZIP** and copied into the repository. The ZIP includes
`masks/manifest.json`, `masks/clothing-matrix.json`, and mask PNGs by gender.
No backend or direct browser write access to the project is assumed.
