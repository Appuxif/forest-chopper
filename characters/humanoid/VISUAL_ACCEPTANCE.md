# Humanoid Lite — visual acceptance (FAILED)

**Status: FAIL.** These are real Chrome screenshots of the current **reverted**
prototype after commit `f90d82a`, not a polished render or a completed asset.
The experimental wardrobe change in `ba534d0` was reverted because it
introduced visible colored polygons / poor-looking seams despite passing all
structural tests.

## Visual evidence

- [Front contact sheet](./qa-baseline/front-contact.jpg) — male/female,
  long-sleeve shirt or T-shirt, jeans or shorts: **eight outfits**.
- [Problem-area contact sheet](./qa-baseline/defects-contact.jpg) — underside of
  both long shirts, short-sleeve fit from both sides, shorts from below.
- The 14 individual JPG screenshots in `qa-baseline/` are retained to inspect
  at original captured resolution. These are the baseline for future visual diffs.

## Observed failures (not hypothetical)

- **Long-shirt hem viewed from below:** a thick, gray, flat strip is clearly
  visible, rather than a natural fabric edge attached to the character.
- **Long sleeves:** open cuffs still look like thick hollow cylinders,
  with faceted, occasionally disconnected-looking interior geometry.
- **Collar / neck:** neck fabric is uneven; previous iterations also showed
  dark spikes around the T-shirt neckline.
- **General silhouette:** fits of the older MakeHuman clothing are too loose
  to pass as properly tailored modules at close camera distances.
- **Layering and extreme animation poses:** not visually accepted yet.
  The 12 imported clips and bone/mesh compatibility tests do NOT prove no
  clipping across their actual motion sequences.

## Mandatory acceptance before claiming this character is finished

For both body types and all four outfits (shirt/T-shirt × jeans/shorts):

1. Capture **front, back, side, and low-angle views** for each combination.
   Also capture close-ups of neckline, both sleeve openings, lower garment
   hem, and trouser/short boundaries.
2. Inspect actual frames (not file existence, triangle counts or only the
   animation's first frame). Inspect at least idle, walk, run and jump with
   shoulders/arms and knees flexing.
3. Mark **FAIL** for any visible gaps into a missing surface, naked skin
   piercing through covered clothing, cloth-colored spikes on exposed skin,
   detached/untextured fabric caps, floating cuffs or broken neck/hand seams.
4. Fix geometry/weights in Blender as needed; rerender the **same camera
   positions** after each change; compare side by side.
5. Only mark PASS after inspecting all combinations with no obvious visual
   defects. Structural tests (53 bones, 12 actions, independent wardrobe
   rigs, 0 morphs) are *additional*, not a substitute for this review.

Important: DO NOT say "checked and looks good" merely because Node/Python
checks passed or the page returned no WebGL errors. Current prototype remains
**not accepted**. The game avatar has not been replaced by this prototype.

## Technical direction

The previous polygon removal and material-ownership experiments failed
because coarse region boundaries cannot align with actual garment openings.
A real solution needs a **shared seam/connector specification** for body and
garments, fitted cloth cuffs/necklines, and compatible skin weights.

Next modeling step: build/validate **one** quality long-sleeve shirt on the
actual low-poly rig, with the wrist/collar/hem explicitly modeled, then
transfer that pipeline to short-sleeve shirts, trousers and shorts.

Do not roll all four garments into a new version before that first sample
passes the visual acceptance checks.
