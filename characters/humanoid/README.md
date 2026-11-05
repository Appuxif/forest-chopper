# Forest Chopper — Humanoid

**Current architecture (2026-11-05):** male, female and classic lumberjack
are loaded by ONE 53-bone LiteHumanoid system. Each character has its own
14 animation clips in a separate body GLB. The source 13-bone
lumberjack/lumberjack.glb is preserved for reference and is not loaded
by the game anymore.

Workbench: characters/humanoid/animation/humanoid_animation_workbench.blend
Export: characters/humanoid/animation/export_lumberjack_preview.py
Runtime assets: game/body_male.glb, game/body_female.glb, game/body_legacy.glb
Character selection keys and saved world settings remain compatible.

All three actors equip the same characters/humanoid/game/axe_shared.glb,
built by running:
    python3 characters/humanoid/animation/build_shared_axe.py
The high-detail five-mesh weapon is loaded once, then cloned into each
handRight socket. The separate lumberjack_axe.glb was deleted; the original
lumberjack.glb remains as historical source. All three rigs have the same
weapon reference in the animation workbench.
The classic rig has a calibrated handRight socket offset in
src/character-model-selection.js; all three models still use the same axe GLB.
The authoring socket is Socket.handRight · Lumberjack in the shared workbench.
This fixes the classic model's original upright handle/blade alignment without
retargeting any hand animation or adding a model-specific loader branch.

**The historical WIP notes below describe older iterations.**

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
The lightweight system has **two** canonical body model files; each owns its
own production action bank (14 clips imported from one shared workbench). The face presets
are tiny, integrated morph targets; there are no separate face GLBs.

- `game/body_male.glb` and `game/body_female.glb`: sole canonical 53-bone body
  files for **both the game and `preview-lite.html`**. Each contains 14 production Actions. The 19 `REF_*` reference clips remain in the Blender workbench and are **not exported**.
- The Blender workbench also contains authored `walk_backward`. At export it
  replaces the deleted in-place `walk_back` without replacing other clips in the runtime
  bank. Both `walk` and `walk_back` move the Root ±1.32m over 30 frames;
  exporter-only normalization produces 31 exact samples over 1.0s.
- The user-authored `strafe_left` / `strafe_right` have ±0.60m X Root
  translation, level Root.Z (vertical sway is on pelvis), and slightly
  closer-but-open arms. Leg poses are extended with baked two-bone IK and
  support-foot contact verified. The exporter normalizes Blender's
  1.25–27.5 frames to 0–26 at 30 FPS: 27 samples, duration 0.867s, and
  complete Root travel. Game sidestep speed is 1.2m/s (1.8m/s with Shift):
  20% slower animation than the older 40cm clips despite longer strides.
  Forward/back walking now plays at 2.0m/s (20% slower than 2.5m/s).
  Forward Run playback remains the original fixed 1.2x.
- Authored `run_backward` is a 20-frame toe-running jog with a modest
  backward pelvis lean, smaller leg swings, short hops, softened hip yaw,
  and matching 20-frame running arm cadence. Root travels 1.16m backwards
  (Blender +Y, runtime -Z) per 0.667s loop. Both forward and backward
  running clips use the same fixed 1.2x playback, which naturally moves
  the backwards run slower (~2.09m/s) without slowing the arm animation.
  The game exports it as `RunBackward` on both genders; classic retains
  reversed `Run`. All 14 gameplay actions share the same 53-bone rig.
- Future per-gender Actions use the names `male__<clip>` and `female__<clip>`
  in `animation/humanoid_animation_workbench.blend` and override the shared
  default clip when exported into the corresponding gender GLB.
- Faces `default/angular/soft` are morph targets on these models, not new rigs.
- `lite/clothing_*_{gender}.glb` and `lite/hair_*_{gender}.glb`: one shared
  catalog and generator, geometry fitted for each sex and rebound onto the
  avatar's active skinned skeleton.
- `humanoid-lite.js`: common character builder for preview and gameplay.
- `build_all_lite.py --bodies-only`: rebuild just two body models from the
  Blender workbench, temporarily creating then deleting six source geometry
  presets. `--force` rebuilds clothing/hair too.
- `preview-lite.html`: 3D character/outfit/face/animation preview.

From the project root:

```bash
python3 -m http.server 8790
# open http://127.0.0.1:8790/characters/humanoid/preview-lite.html
python3 characters/humanoid/build_all_lite.py --jobs 4 # skips existing
python3 characters/humanoid/build_all_lite.py --bodies-only --jobs 3 # rebuild animation/body GLBs
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
| Long-sleeve shirt (male, original open rims) | 1,209 |
| Jeans (male) | 821 |
| Shoes (male) | 1,062 |
| Short hair 02 (male) | 1,069 |
| **Dressed default male** | **10,052** |
| **Dressed default female** | **10,051** |

Actual counts depend on equipped items; a second jacket, long hair or other
layers can push beyond 10k. The 10k target refers to one ordinary clothed
avatar without extra layers. A two-layer outfit can reach ~11–12k.

### Единственная система скрытия кожи: PNG и матрица

Only the author-created PNGs in masks/male and masks/female and the assignments
in masks/clothing-matrix.json control visible body skin. skin-mask-matrix.js
resolves item IDs to mask names; body-mask-runtime.js composites the masks as
cached alphaMaps. No body vertex displacement, bone-zone masks, garment
projections, procedural shoulder corrections or triangular sealing caps.
The preview uses the same matrix resolver with skin-paint.js for interactive
painting. Editor-only localStorage overrides must be exported to files to be
used by the game. Female mask assignments are currently empty in the repository.

The MakeHuman garments deliberately keep their original **open cuffs,
collars, and hems**. Do not use the obsolete seam-bridge generator: it adds
visible triangular plugs at sleeve openings and conflicts with the later skin
mask library. Rebuild shirts/T-shirts through `build_lite.py` or
`build_all_lite.py --force` if old sealed assets are present. The runtime uses
`THREE.DoubleSide` for the inside surfaces, and the independent skin-mask
system handles covered body regions.

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

## Reusable fabric and color variants (experimental)

`source/clothing-variants.json` defines material variations for the existing
low-poly clothing meshes: T-shirts, shirts, hoodies, jeans, shorts, boots,
shoes, jackets, trenchcoats, briefs, panties, and bras. Skirts and dresses are
intentionally excluded from this forest-themed assortment.

`textures/clothing/<item-id>/<variant-id>.png` contains 512×512 sRGB albedo
textures, including plaid flannel, denim twill, workwear canvas, fleece,
leather, suede, and worn waxed fabric. Textures are deterministic and can be
regenerated with `python3 characters/humanoid/tools/generate_clothing_textures.py`
(Pillow required). All variants reuse existing male/female GLBs, shared
skeletons, UV layouts, normal maps, and base skin/clothing mask logic.

The default variant keeps the original GLB material. At runtime call
`await actor.setClothingVariant(slot, variantId)`, where variantId is listed
under `catalog.variants.items[actor.appearance[slot]]`. Switching variants
updates only material maps, color, and roughness; the fitted mesh and automatic
layer mask stay in place. `createLiteHumanoid({clothingVariants:{top:'red-plaid',
shoes:'tan'}})` supports initial selections.

`preview-lite.html` offers material dropdowns immediately beneath each piece of
clothing. The editor remembers each chosen variant per gender and item via
localStorage and includes current selections when copying the configuration.
No new mesh files are generated. This feature is awaiting the user's visual
review as agreed for fast vibe coding; no new tests were run.

## Hoodie equipment slot

Hoodie is an `outerwear` item (like jacket and trenchcoat), so only one of
these can be equipped at a time. It retains the existing mesh, fabric variants,
and per-item skin mask assignments. The experimental outerwear expansion
slider was removed; no new overlap-baking work is needed.

Garments are no longer forcibly hidden based on type. Body-skin visibility is
managed solely through the named mask matrix.

## Permanent morph-aligned skeleton (2026-11-01)

`build_lite.py` now adjusts **all 53 rest-pose joints** using the same
`gender_male` / `gender_female` morph offsets and weight `0.8` that it bakes
into the body and outfit meshes. The previous build morphed mesh vertices but
left the bones in their neutral unisex positions. That caused the finger
controls to sit centimetres away from the skinned fingers in Blender.

The corrected **production** models are all 50 `lite/*.glb` files. There is
no longer a separate `lite-rigfix` runtime, preview switch, or alternate
export mode. Body, garments, and hair are always built with matching joint
rest poses and inverse bind matrices. Bone names, hierarchy, 12 game clips,
mesh vertex positions, UVs, and skinning weights remain unchanged.

Rebuild with `python3 characters/humanoid/build_all_lite.py --force --jobs 4`.
The test `test_humanoid_lite.py` verifies every gender-specific joint against
`source/base_body.joints.json` and the garment-to-body bind compatibility.

For authoring **all humanoid animation Actions**, use the only animation
source file: `animation/humanoid_animation_workbench.blend`.

## Shared, gender-neutral animation workbench (2026-11-01)

**Single editable animation scene:** `animation/humanoid_animation_workbench.blend`.
The rig is `Humanoid_Rig53` (53 named joints). It contains 13 Actions:
`Chop` (the user's complete, 2120-key action) plus the 12 existing `idle`,
`walk`, `run`, `jump`, etc. actions. Change the current Action through Blender's
**Dope Sheet → Action Editor**. The NLA strips are muted, to prevent blending
other clips while editing. Change Scene frame start/end to the chosen clip's
range when previewing (Chop uses frames 1–48).

**Male and Female reuse the exact same bone Actions**, with separate gender-
specific mesh rest poses and bind matrices. Future differences, if needed,
should be implemented only when they are artistically warranted. The model-
creation `.blend` files at the humanoid root are distinct model-source files,
not alternative animation workbenches.

The `AXE_GRIP` remains bone-parented to `hand_r` in the single workbench.
It is *only* an animation reference prop and is not exported with body GLBs.
The asset pipeline produces gender-specific body, clothing and hair GLBs,
but does not produce more workbench `.blend` copies. Save this **same** scene
and commit changes through Git; older animation scenes were deleted.

The same 30 finger-bone poses from frame 1 of `Chop` are applied to the 11
remaining stock animation clips in **both** `body_male*.glb` and `body_female*.glb`,
without editing wrist, arm, or locomotion channels. The independently authored
`idle` is an exception. The versioned snapshot is
`animation/chop_finger_pose.json`. Whenever the first Chop frame changes,
refresh the snapshot and rebuild exported models:

```shell
blender -b characters/humanoid/animation/humanoid_animation_workbench.blend \
  --python characters/humanoid/tools/extract_chop_finger_pose.py
python3 characters/humanoid/build_all_lite.py --jobs 4 --force
```

The 12 standard clips are currently exported in each body GLB; the hand-
authored `Chop` is preserved as an Action in the canonical `.blend` and will
be exported into the game during character integration. This avoids mutating
non-animation model assets before that export is ready.

### Match Chop rest/end frames across idle, jump and land

`animation/humanoid_animation_workbench.blend` is still the **only** authoring
`.blend`. The **complete 53-bone pose** from frame 1 of `Chop` is copied to:

- first and last keys of `idle`, `idle_breathe`, `idle_fidget`, `idle_look`, `jump`
- last key only of `land` (its first key is unchanged)

All interior keys and all other Actions remain unchanged. The pose snapshot
`animation/chop_pose_endpoints.json` contains all 530 animation channels.
To refresh after modifying Chop in Blender, save the single workbench and run:

```shell
blender -b characters/humanoid/animation/humanoid_animation_workbench.blend \
  --python characters/humanoid/tools/align_chop_endpoint_poses.py
python3 characters/humanoid/build_all_lite.py --jobs 4 --force
```

The body GLB exporter applies the same boundaries to all six Male/Female
body-and-face variants, while preserving each other channel's interior.
Some upstream glTF clips omit static bone channels, so the builder adds
only the necessary boundary overrides to **stock** clips; the fully authored
`idle` overrides its entire action. For `land`, which ends on a fractional
frame in the upstream action, the last integer export sample is explicitly
pinned as well; the canonical Blender Action's frame range remains untouched.

### Artist-authored `idle` (Male + Female)

The original eight-second stock `idle` is **no longer** the runtime idle.
`build_lite.py` imports the complete `idle` Action (all 53 bones and keyframes)
from the single `animation/humanoid_animation_workbench.blend` and replaces the
stock NLA Action in every male/female body GLB. The authored clip has keys on
frames 1, 25 and 47 at 30 FPS (approximately 1.5 seconds). The pipeline
compensates for the upstream base animation scene's 24 FPS without retiming
any other clips. It deliberately **does not** impose the old Chop finger pose
or endpoint overrides on this handmade `idle`; the Action is the source of truth.
The 11 other clips still follow the legacy build rules until individually
replaced by authored Actions.

After editing `idle`, **save** the existing workbench in Blender and rebuild
both genders' body GLBs with `build_all_lite.py --force` (or `build_lite.py`
for each gender/face). Reload the game on port 8791 to see the new animation.
Version the single `.blend` via Git instead of creating additional files.
