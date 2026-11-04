# Forest Chopper — reference motion actions (KayKit / CC0)

The workbench `humanoid_animation_workbench.blend` now includes **19 new
comparison Actions** named `REF_*`. **None of the existing 13 authored Actions
(`run`, `walk`, `Chop`, etc.) were replaced.** The game does not automatically
use these reference actions. They are for visually comparing motions and
selecting future movements.

## Preview in the browser (Humanoid Lite editor)

Open `characters/humanoid/preview-lite.html` through the project's HTTP server.
The **Анимация → Клип** dropdown contains the 13 exported production clips.
The 19 KayKit reference clips are available only in Blender Action Editor;
they are excluded from game and browser preview GLBs to save space.
**↻ Повторить анимацию** restarts one-shot production clips. The animation description shows the
source, duration and loop mode. Your selection survives switching gender
or face presets. The speed slider and skeleton checkbox work as before.

The editor uses **the same** `game/body_male.glb` and `game/body_female.glb`
as the game; each contains only the 13 production Actions. The 19 `REF_*`
experiments are Blender-only, not exported to game or preview GLBs. There is no separate animation GLB, hidden proxy rig or second mixer.
Three face variants (`default`, `angular`, `soft`) are integrated as morphs
inside each single body GLB.

After editing a production Action or authoring a gender-specific action, rebuild
both body models (clothing/hair are reused). REF_* Actions are filtered out:

```bash
python3 characters/humanoid/build_all_lite.py --bodies-only --jobs 3
```

The build creates temporary inputs, filters out REF_* Actions in Blender memory,
packs two self-contained production GLBs and removes temporary geometries. Workbench and existing cloth GLBs are untouched.
To override a clip for one gender, name the Action `female__walk` or
`male__run`: the default action will stay in the other gender's GLB.

## How to preview in Blender

1. Open `humanoid_animation_workbench.blend` (reopen the file if it was already
   open when the references were imported).
2. Select armature `Humanoid_Rig53` and switch a Dope Sheet panel to **Action Editor**.
3. Select an Action starting with `REF_` from the dropdown; set the scene
   playback range to the Action's frame range (all start at frame **1**).
4. Press **Space** to play. In the Action Editor, switch between the original
   `run`, `walk`, `Chop` and reference `REF_...` actions to compare.

| Category | Actions in workbench | Original KayKit clip |
| --- | --- | --- |
| Walk, 3 options | `REF_KayKit_Walk_A`, `_B`, `_C` | Walking_A / B / C |
| Run, 2 options | `REF_KayKit_Run_A`, `_B` | Running_A / B |
| Running strafe | `REF_KayKit_Run_StrafeLeft` | Running_Strafe_Left |
| Attacks, 4 options | `REF_KayKit_Attack_Axe1H`, `_Axe2H`, `_Diagonal`, `_Horizontal` | Melee_1H_Attack_Chop / Melee_2H_Attack_Chop / Melee_1H_Attack_Slice_Diagonal / Slice_Horizontal |
| Chopping, 2 options | `REF_KayKit_Chopping_Loop`, `REF_KayKit_Chop_Sequence` | Chopping / Chop |
| Woodworking | `REF_KayKit_Sawing_Loop`, `REF_KayKit_Hammering_Loop` | Sawing / Hammering |
| Crafting / workstation, 3 options | `REF_KayKit_Work_Bench_A`, `_B`, `_C` | Working_A / B / C |
| Using item | `REF_KayKit_Use_Item` | Use_Item |
| Eating experiment | `REF_Experimental_Eat_HandToMouth` | **Modified** Use_Item with procedural hand-to-mouth reach |

## Source, license, and important limitations

- **Creator:** Kay Lousberg (KayKit Character Animations).
- **License:** [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), free for commercial projects, no attribution required (though recommended).
- **Official source:** https://kaylousberg.itch.io/kaykit-character-animations
- **Public GLB mirror:** https://github.com/NoLimitNexus/game-models/tree/main/library/animations — packs `Rig_Medium_MovementBasic`, `MovementAdvanced`, `CombatMelee`, `Tools`, `General`.
- **Retarget script:** `import_kaykit_references.py`, using 23 KayKit joints mapped to the existing 53-bone `Humanoid_Rig53`; the source skeleton is **not** saved in the Blender workbench. This retarget is a first-pass preview, not hand-polished production animation. Some hand/axe contacts may need adjustment.
- **Locomotion:** these CC0 walking/running reference variants are largely *in-place*. The production Actions `walk` and `walk_backward` (not `REF_*`) now have authored Root Motion (±1.32m per 30-frame cycle), validated for planted-foot drift. Export maps `walk_backward` to the runtime `walk_back` clip, replaces the old in-place Action, and normalizes frame timing to 0–30 at 30 FPS. The other authored locomotion Actions are unchanged.
- **Tools and props:** woodcutting assumes a suitably positioned axe, sawing assumes a saw, and crafting assumes a table/work surface. Props are not part of the source Action.
- **Eating:** `REF_Experimental_Eat_HandToMouth` is an explicitly *derived* experiment, not a third-party standalone eating recording. It brings the right hand toward the mouth without any food mesh; tune finger grip and item attachment separately.

## Reimporting the references

Save your latest `.blend` before doing this, then run from the project root:

```bash
blender -b characters/humanoid/animation/humanoid_animation_workbench.blend \
  --python-exit-code 1 \
  --python characters/humanoid/animation/import_kaykit_references.py \
  -- --output /tmp/forest-chopper-kaykit-preview.blend
```

The script downloads five CC0 GLB reference packs into `/tmp/forest-mocap-source`
(or uses already cached copies), checks pinned SHA-256 hashes, and saves the
new file specified by `--output`. It never overwrites the input automatically.
Check the resulting file before replacing your workbench.
