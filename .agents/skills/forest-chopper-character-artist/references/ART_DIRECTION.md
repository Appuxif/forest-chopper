# Art direction and sculpt QA — Forest Chopper

## Character style

- Stylized, readable, intentionally sculpted game characters in a lively forest setting. Prefer coherent rounded/chamfered forms and a little heroic exaggeration to thin realistic detail.
- At normal third-person camera distance the head silhouette, body type, hat/hair, beard, weapon and distinctive garment must remain identifiable.
- Design first in three values (dark, mid, light) and broad color masses. Avoid noisy uniforms of tiny details.
- Appropriate proportions depend on species/class: ordinary human baseline roughly 6–7.5 heads tall, but choose a consistent deliberate stylization. Giant feet or hands can be intentional if the rest of the design supports it.
- Accessories need purpose: belts should hold something, straps should wrap anatomy, collars should sit on shoulders, armor should have a sensible overlap.

## Anatomy checklist

| Region | Must look right |
|---|---|
| Head | skull to jaw relation, forehead, brow ridge, ears, natural neck attach, eyes and nose clearly oriented |
| Shoulder | deltoid from torso, upper arm emerges without a tube-like seam |
| Arms | readable elbow and wrist, forearm taper and hand volume, no straight rigid doll stance |
| Hands | all fingers and thumb where intended, proper curled grip around tool, no arbitrary amputations |
| Torso/hips | believable rib cage, waist and pelvis, garment drape following body |
| Legs | readable knees, calves, ankles, planted feet, boots not floating |
| Silhouette | recognisable at thumbnail size from front, side, 3/4 and back |
| Gear | correct ergonomics; axe blade orientation and handle grip visible from two angles |

## Recommended modeling order

1. Blockout broad volumes and material color blocks. Compare proportions from orthographic front and side.
2. Remodel the torso-head-joints using consistent anatomy and smooth transitions. Shape the face with deliberate planes.
3. Add garment shapes around existing anatomy: tunic, sleeves, pants, belt, boots, gloves and characteristic gear. Don't leave major intersection faults.
4. Model hands at useful gameplay scale, then seat the axe in the right hand and shape the grip around the handle.
5. Refine edges and surfaces using sculpting/mesh topology where it helps the silhouette, *not* gratuitous subdivision.
6. Retopo/UV and material tests; make contrasting accents pop without noisy texture.
7. Test poses and silhouettes again after rigging. Weight painting is part of sculpt quality.

## Visual inspection protocol

Capture screenshots/renders of:
- Orthographic front, side and rear, plus a 3/4 view, with camera framing and scale consistent.
- Face/head closeup; right hand + axe from front and side; fingers in closed grip.
- Neutral/Idle, mid-walk, mid-run, mid-jump, wind-up of chop, contact and recovery.
- The *two adjacent loop frames* at the Idle end/start boundary.
- A reduced thumbnail (about 160px tall) resembling the actual game camera.

Reject a model for: arms held unnaturally wide in Idle, offset/misaligned axe, fingers missing or stabbed by the handle, floating details, warped topology, clothing poke-through, collapsed elbows/knees, sudden loop jerk, broken forward/backwards orientation, self-shadow artifacts or bizarre shading.
