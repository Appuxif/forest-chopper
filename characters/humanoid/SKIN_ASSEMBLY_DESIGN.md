# Humanoid vNext: surface replacement, not clothing over a complete body

## Why

In the earlier Lite Humanoid, skinned cloth and skinned body are two overlapping
surfaces. During walk/run, fingers or arms occasionally pierce the cloth. When
large body triangles were hidden, their cut edges exposed empty sky through the
neck, sleeve and shirt hem. Insetting the body and adding linen strips reduced
the visual error, but did not solve its cause.

The *character is an assembly of visible skinned surfaces*, not one intact
hidden body plus layers of clothing. Bare skin is the default appearance of a
surface slot, alongside clothing, armor and gloves.

## Rule

All surface modules use the SAME 53-bone skeleton and the same rest-pose
coordinate system. No independent garment rigs and no dynamic humanoid morphs.
The outfit controls which anatomical regions exist in the rendered character.

A logical skin slot is not necessarily a new draw call. Build/batch the active
skin region polygons into one skinned body geometry with one skin material,
with clothes as additional skinned surfaces. Keep the immutable full-body GLB
for unequipped/default state.

Example:

- Long-sleeve shirt replaces torso, upper arms and forearms. Neck/head and
  hands are the exposed skin parts; there are NO arms or chest under cloth.
- T-shirt replaces torso and upper arms. Forearms and hands remain exposed.
- Jeans replace pelvis, thighs and calves. Shoes replace feet.
- Bare upper body restores bare torso and both arms. Gloves could replace
  hand skin, and high boots may later also replace some calf skin.
- Outer jacket is an outerwear layer, not another torso skin replacement; must
  mask the *inner clothes surface* where appropriate to avoid fabric clipping.

See skin-assembly.js for the declarative part ownership rules. It does not yet
switch live mesh topology, intentionally: Blender seam fitting must happen
before enabling it in the viewer or game.

## Seam contract (critical; segmentation alone does not prevent holes)

A garment has named connection boundaries (neck, wrists, upper-arm sleeve
rings, waist, thighs, ankles). At export time, its opening must align to the
neighbor module's corresponding rest-pose ring. Every boundary:

1. Uses the same base armature and consistent bone weights along the seam.
2. Terminates immediately outside the adjacent exposed skin, with 3–8 mm
   *overlap tucked inside* the garment. Avoid coplanar flicker.
3. Has textured inner faces and a short end rim if the cloth is thick or loose.
4. Does not expose a cut in the interior of another body part from below.
5. Is validated in idle, walk, run, jump, and arbitrary arm flexion.
6. Must work for both male/female prebaked bodies.

For loosely hanging hems, do not force a fabric-to-body plastic fill. Prefer
inner cloth facing plus a natural waist/pants surface visible under the hem;
use fabric to conceal any skin mesh joint. The lower visible skin region must
remain present under an open shirt hem. This is a tailoring/design constraint,
not something an arbitrary one-size-fits-all polygon masker can solve.

## Next implementation increment

1. Generate named skin region meshes/masks from the base low-poly humanoid,
   including deliberately retained under-cuff/neck seam rings.
2. Make **one** slim, fitted long-sleeve test garment with matched neckline,
   wrist rings, and lower hem; test it with head/neck and hand skin modules.
3. Validate visually from inside cuffs, under hem, front of collar, plus run
   and arm raised poses. Iterate geometry before enabling for all clothes.
4. Hook up the slot resolver in the live actor to replace body regions, then
   extend to T-shirts, shorts, pants, armor, and gloves.

Until the garment seams and body region partition match, keep current Lite
viewer renderer as a fallback rather than shipping another visible hole.
