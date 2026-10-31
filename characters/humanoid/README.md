# Forest Chopper — modular anatomical Humanoid (WIP)

**This is a new character system, not a rework of the game's legacy lumberjack.**
The previous procedural Rowan character was deleted. The production
`lumberjack/lumberjack.blend`, `lumberjack/lumberjack.glb`, and JS loader are unchanged.

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
