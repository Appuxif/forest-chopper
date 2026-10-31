# Blender pipeline and delivery

## Tools

- Preferred: Blender MCP scene inspection, incremental `execute_blender_code`, camera screenshot/angle visualization (`look`); confirm availability. Live Blender is someone's working session: don't clear or overwrite it.
- Fallback: `blender -b <source.blend> --python-exit-code 1 -P <your_script.py>`. Use `--factory-startup` only for new/isolated scenes.
- In Blender 5.2, rely on `bpy.data`/bmesh. Selection-based operators often need correct context; `Action` uses slots/layers, not the old flat `.fcurves` API.

## Deliverables

- New character default: `characters/<slug>/<slug>.blend` + `characters/<slug>/<slug>.glb`; optionally `characters/<slug>/renders/` and reproducible `build_<slug>.py`.
- Existing lumberjack improvement: work on copy `lumberjack/<descriptive-candidate>.blend` and export `lumberjack/<descriptive-candidate>.glb`; replace `lumberjack/lumberjack.glb` only when requested and verified.
- Do not commit reference images/textures without a compatible license; prefer own procedural artwork and assets. Never scrape/purchase AI-generated/third-party assets silently.

## Modeling / rigging notes

- Units in metres; feet on ground; forward orientation as dictated by existing model and runtime, not a generic rule.
- For a hero, first check silhouette/readability with solid shading and workbench renders. For a detailed sculpt create a high-poly source and retopo low-poly that preserves planes/volume; bake where needed.
- Use no more than 4 weight influences for mobile-friendly skinning; normalize, inspect uncovered vertices and armature modifier targets. Rigid axe has 100% Hand.R influence or correct bone parent; correct attachment offset in bind/rest pose.
- Default optional new character target: 12–25k triangles and <=10 materials; verify against game camera and multiplayer load; use actual baseline before optimization.
- When generating a procedural model, keep scripts deterministic with a fixed seed and named parameters; no unsaved destructive operations.

## Animation process

- Start from physically sensible key poses. For Idle create a subtle breathing/weight-shift motion returning precisely to opening pose.
- For loops prefer keyframe endpoints that agree on body/rotations; locomotion root displacement may be nonzero by design.
- Block contact/down/passing/up in locomotion; ensure ankle/foot orientation and stride consistent with the engine's time scaling.
- During chop keep hand-axe relationship rigid throughout wind-up, impact and recovery. Confirm blade faces intended target.
- Bake constraints/drivers/IK to deform skeleton if used. Avoid exporting control rig bones. Each exported action has the exact clip name expected by the engine.
- Blender export: use `bpy.ops.export_scene.gltf(filepath=..., export_format='GLB', use_selection=True, export_animations=True, export_skins=True)` after carefully selecting rig + related export meshes. Blender 5.2 exporter parameter names should be inspected at runtime if errors occur. Export through the UI if the scene's action setup needs review.
- Do NOT rely on a driver or F-curve cycles modifier being preserved by GLB; sample/bake values before export.

## QA commands

```bash
python3 .agents/skills/forest-chopper-character-artist/scripts/check_glb.py lumberjack/lumberjack.glb --profile lumberjack
python3 .agents/skills/forest-chopper-character-artist/scripts/check_glb.py characters/other/other.glb --profile generic
python3 -m unittest discover -s tests -p 'test_character_asset_inspector.py' -v
```

The inspector checks the GLB container, skins, rig node hierarchy, names, animations, non-bone animation tracks and root motion (for the lumberjack), triangle/material budgets and reports machine-readable JSON. **It cannot prove artistic quality, smooth looping, deformation, hand/axe alignment or browser rendering.** A `PASS` is only one gate.

## Final manual QA

- In Blender: same-scale front/back/side/3-4 shots, face, hands and axe close-up; check 0/25/50/75/100% keyframes and loop boundaries at gameplay speed.
- In Three.js: import candidate in an isolated scene or temp URL first, compare to a known-good GLB, verify animation clips, world orientation/scale, weapon and shadows, and look for console warnings.
- On replacing live lumberjack: both `index.html` and `index_debug.html`, plus a cloned multiplayer actor (SkeletonUtils) and animation overlays; never alter public world save or user's opened tab for a test.
- Report what was actually checked; if Blender visual or runtime inspection was not possible, say so explicitly.
