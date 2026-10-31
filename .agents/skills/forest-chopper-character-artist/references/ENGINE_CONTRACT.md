# Forest Chopper engine contract (checked against working tree 2026-10-31)

This is a project-specific compatibility target, **not** generic Blender advice. Before modifying a character, re-open `src/animations.js`, `src/player.js`, and the actual target GLB: the code may have changed since this snapshot.

## Existing character files

- Source: `lumberjack/lumberjack.blend` (other working/experimental `.blend` files may coexist; preserve all).
- Runtime: `lumberjack/lumberjack.glb`, loaded by `src/animations.js` with `GLTFLoader` and cloned via Three.js `SkeletonUtils.clone`.
- Current GLB: ~2,177,332 bytes, 58 meshes, 1 skin, 10 materials, ~31,380 triangles.
- There are multiple mesh objects and **one Armature** (`Lumberjack Rig`). This is correct: **one rig != one mesh**.
- Existing `.blend` also contains camera, lights and a render stage: these belong to the source scene, not the exported character.

## Skeleton / clip names

One skin with joint names:
`Root`, `Hips`, `Spine`, `Head`, `UpperArm.L`, `Forearm.L`, `UpperArm.R`, `Forearm.R`, `Hand.R`, `Thigh.L`, `Shin.L`, `Thigh.R`, `Shin.R`.

The working GLB includes 9 clips, with **exact case-sensitive names**:
`Idle`, `Walk`, `Run`, `Death`, `Jump`, `Chop2`, `Chop`, `StrafeLeft`, `StrafeRight`.

The project's JS normalizes Blender dots/underscores for matching, then splits clips into:
- Lower group: `Root`, `Hips`, `Thigh.L`, `Thigh.R`, `Shin.L`, `Shin.R` (normalized).
- Upper group: everything else, including `Spine`, `Head`, arms and right hand.
- `Chop2` is the upper-body attack overlay. It must not drive player locomotion/leg state; the JS masks lower tracks from it.
- The attack is triggered as a one-shot, then blends back to current locomotion; don't replace `Chop2` with another name without changing and testing code.

## Motion / orientation

- `src/player.js` computes motions `Idle`, `Walk`, `Run`, `StrafeLeft`, `StrafeRight`, and overrides with `Jump` when airborne.
- The loader applies `visual.rotation.y = Math.PI` to orient this GLB in world space. Check exact front/back when changing Blender export axes; don't "fix" it twice.
- `src/animations.js` reads the `Root.position` channel for `Walk`, `Run`, `StrafeLeft`, `StrafeRight`. It extracts X and Z translation and zeroes horizontal Root translation in the visual clip while advancing the actor in world space via the extracted delta. Preserve the Root position track and meaningful movement there.
- The engine uses playback rates roughly 2.25× for walk, 2.35× for run, 4–5× for strafing, and negative rates for backward locomotion. Validate loop quality and foot sliding at these accelerated/reversed rates.
- The first-person axe is a **separate JS object**; don't confuse it with the third-person weapon attached to the GLB character.

## Compatibility rules

- A replacement must maintain action names, bone names (or an explicitly tested migration), skin binding, rooted locomotion, right-hand tool attachment and reasonable character scale.
- Don't introduce independently animated weapon or mesh-object tracks. Current clips only animate rig joints.
- Use a **single exported deform skeleton** and drive weapon geometry rigidly from `Hand.R` (bone parenting or skinning).
- Preserve current production GLB until candidate passes Blender and browser QA; users might have other uncommitted work.
- Verify real game in both local and remote-player actor states when replacing a character; one multiplayer avatar is a cloned skinned model.
