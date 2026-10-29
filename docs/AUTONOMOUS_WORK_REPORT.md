# Autonomous work report — Forest Chopper

- Date: 2026-10-29
- Branch: `overnight`
- Baseline: `d1d0057`
- Scope: ordinary game client, stability, tests. No pushes or real-world saves.
- Existing untracked `.codex/` was left untouched.

## Completed

### P0.1 — Dispose of owned Three.js resources

- Added `disposeTree(tree)`: disposes **only** per-tree scar geometry and material, leaving trunk/leaf/grass shared resources intact.
- Called cleanup during chunk unload, after falling-tree animation, while resetting the offline world, and on multiplayer world replacement.
- Added `disposePreview()`: releases an owned transparent preview material on exiting build mode or world reset; placed logs and their shared log geometry/materials remain alive.
- Dispose fallback multiplayer avatar mesh resources on disconnect (when the GLB actor is unavailable); CanvasTexture and tag material cleanup already existed.
- Added `tests/resources.test.mjs` to exercise 130 chunk unloads and 140 preview open/close cycles; checks disposal counts, idempotence, and shared resource safety.
- Browser: local isolated `index_debug.html` loaded on desktop with no console errors; created and cleared preview, verified only one preview mesh exists at a time; on mobile (390 × 844) zero preview meshes remain after mode exit.
- Browser graphics memory: the first preview render raised geometry count from 63 to 64 while visible; after its removal this returned to 63. Texture count remained 58. **This is not a direct material-memory measurement**; JS mock tests validate material disposal calls.
- Browser screenshots (temporary, outside repository): `/tmp/forest-chopper-overnight-p0-desktop.webp`, `/tmp/forest-chopper-overnight-p0-mobile.webp`.

## Validation

- Initial Python baseline: 1 test passed; initial JS syntax check passed.
- P0.1: Python unittest 1/1 passed; JS `node --test tests/resources.test.mjs` 2/2 passed; `node --check` for `src/*.js` passed.
- Isolated browser test: page loaded with WebGL2, `window.__gameDebug` available in debug page; no errors after fixing one syntax issue caught during development.
- No changes made to world seeds, tree IDs, saved world format, bot or network protocols.
- Visual quality/subjective game feel was not assessed by a human.

## In progress / next

- P0.2 — Validate placement/removal consistently in offline and online modes.
- P0.3 — Expand protocol and physics regression tests.
- P0.4 — Polish keyboard/chat and touch UX.
- P1 — Notifications, hit feedback, hints, and quality-of-life when P0 is stable.

## Git

Small task-scoped commits on `overnight`. Detailed commit bodies include the checks performed. No push.
