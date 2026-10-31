# Humanoid vNext: surface replacement, not clothing over a complete body

## Why

In the earlier Lite Humanoid, skinned cloth and skinned body are two overlapping
surfaces. During walk/run, fingers or arms occasionally pierce the cloth. When
large body triangles were hidden, their cut edges exposed empty sky through the
neck, sleeve and shirt hem. Insetting the body and adding linen strips reduced
the visual error, but did not solve its cause.

The *character is an assembly of skinned visible surfaces*, and skin is treated as
default equipment rather than the required appearance under every garment. Bare skin is the default appearance of a
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

- Long-sleeve shirt replaces the *visual ownership* of torso and arms up to
  wrist. Hands/head/neck remain visibly skin. The inner covered geometry is
  shaded as fabric, not naked skin.
- T-shirt replaces the torso; its loose sleeves overlap intact upper-arm skin
  to avoid visible sawtooth material boundaries. Forearms and hands stay skin.
- Jeans replace the visual ownership of pelvis and legs; shoes cover feet.
- Shorts own the pelvis while thighs stay skin beneath loose leg openings.
- Bare upper body restores bare torso and both arms. Gloves could replace
  hand skin, and high boots may later also replace some calf skin.
- Outer jacket is an outerwear layer, not another torso skin replacement; must
  mask the *inner clothes surface* where appropriate to avoid fabric clipping.

The Lite viewer now uses skin-assembly.js and surface-groups.js live. The
current implementation uses **material ownership** of triangles on the same
continuous low-poly body skin (up to four material groups): uncovered areas
render skin, covered areas render an opaque fabric-colored inner surface. The
actual garment shell remains a separately skinned mesh. This avoids missing
triangles and colored bare skin showing through openings, but is not yet a
physically separated set of custom-fitted torso/arm/neck GLBs.

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

## Verified Lite sample kits (October 2026)

The renderer composes four combinations: long-sleeve shirt or short-sleeve
T-shirt, each with jeans or shorts, for male and female source bodies. Both
shirts have skinned inside seam bridges at the neckline, sleeves and lower hem.
The loose shirt cuffs and hem were pulled toward the skinned body at bake time.
All eight combinations preserve the complete body index buffer, use 53 shared
bones, and retain the 12 original animation clips. Automated browser checks
were run on idle/walk/back/run/strafe/jump/land/fall. Manual inspection covered
front, side, back and below.

The visual fit is improved but not guaranteed watertight under every extreme
pose: UV-edge irregularities and cloth/cloth layering may still require
manual 3D tailoring. The underlying skin material is not rasterized where
inner fabric owns the surface; there are no artificially missing polygons.

## Next implementation increment

1. If true mesh replacement is later needed, cut separate skin meshes at
   defined mesh seam rings, not at arbitrary low-poly bone-weight boundaries.
2. Tailor clothing edges and bone weights to those rings in Blender.
3. Validate with raised arms, running and deep bends before enabling for NPCs.
4. Consider material atlas/batching for large multiplayer crowds; the current
   grouping costs up to four draw calls on the inner body instead of one.
