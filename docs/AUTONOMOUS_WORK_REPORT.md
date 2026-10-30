# Autonomous work report — Forest Chopper

- Date: 2026-10-29
- Branch: `overnight`
- Baseline: `d1d0057`
- Scope: ordinary game client, stability, tests. No pushes or real-world saves.
- Existing untracked `.codex/` was left untouched.

## Completed

### P0.1 — Dispose of owned Three.js resources (`0dc3667`)

- Added `disposeTree(tree)`: disposes **only** per-tree scar geometry and material, leaving trunk/leaf/grass shared resources intact.
- Called cleanup during chunk unload, after falling-tree animation, while resetting the offline world, and on multiplayer world replacement.
- Added `disposePreview()`: releases an owned transparent preview material on exiting build mode or world reset; placed logs and their shared log geometry/materials remain alive.
- Dispose fallback multiplayer avatar mesh resources on disconnect (when the GLB actor is unavailable); CanvasTexture and tag material cleanup already existed.
- Added `tests/resources.test.mjs` to exercise 130 chunk unloads and 140 preview open/close cycles; checks disposal counts, idempotence, and shared resource safety.
- Browser: local isolated `index_debug.html` loaded on desktop with no console errors; created and cleared preview, verified only one preview mesh exists at a time; on mobile (390 × 844) zero preview meshes remain after mode exit.
- Browser graphics memory: the first preview render raised geometry count from 63 to 64 while visible; after its removal this returned to 63. Texture count remained 58. **This is not a direct material-memory measurement**; JS mock tests validate material disposal calls.
- Browser screenshots (temporary, outside repository): `/tmp/forest-chopper-overnight-p0-desktop.webp`, `/tmp/forest-chopper-overnight-p0-mobile.webp`.

### P0.2 — Validate offline and online building actions

- The same `placeError()` check drives preview color, local placement, and outbound multiplayer placement commands.
- Recomputes snapped placement at action time instead of trusting the last rendered preview; respects the 16-level height limit and wood inventory.
- Prevents log placement/removal outside build mode. Missing logs and blocked placements provide a meaningful `buildhint` message.
- Offline placement/removal mutates local wood/logs. Online actions only send validated commands; the server remains authoritative and must acknowledge them.
- Added `tests/building.test.mjs`: 9 real scenarios for both modes, insufficient wood, 16 levels, stale preview, removal, and green/red preview.
- Isolated mobile browser (390 × 844): no-wood preview is red, placement stays at wood=0, warning is visible, leaving build mode removes preview, and no console errors appeared.

### P0.3 — Protocol, physics and save/load regression coverage

- Added `tests/physics.test.mjs`: oriented log footprints, horizontal collision, axis sliding around tree trunks, landing on stacked supports, and head collision.
- Added `tests/test_world.py`: isolated ephemeral WebSocket test server and a temporary save directory; covers human welcome, join/leave, chat, invalid JSON and coordinates, hit cooldown, tree damage/fell rewards, and world seed/felled/damage/log save-load roundtrip.
- The original production world and public multiplayer are never accessed. Existing bot test is preserved.
- Full suite: Node 14/14, Python 3/3, JS syntax and `git diff --check` pass.

### P0.4 — Partial: clear interrupted touch input

- The renderer now clears swipe tracking on `pointercancel` (previously only on `pointerup`).
- Window blur now resets mobile joystick displacement and swipe tracking as well as the existing keyboard reset, preventing unintended movement after switching tabs or losing focus.
- JS syntax and existing 14 Node + 3 Python tests pass. Isolated Chrome debug page verified simulated blur clears WASD and joystick knob displacement. Full real touch gesture interaction and visual polish remain to be reviewed.
- Existing mobile hint text and both HTML entrypoints match except for debug title; no text correction was necessary.

### P0.4 — Keyboard repeat / chat-focus corrections (2026-10-30)

- `B`, `V` and `R` no longer repeatedly toggle construction, camera, or log orientation when a key is held; repeated keyboard events are ignored for these toggles.
- Closing chat now blurs the chat input. `Escape` closes it and restores the normal keyboard input path without requiring a mouse click on the canvas.
- Browser (isolated debug page) verified repeat event gating, chat input suppresses movement, Escape collapses + blurs, WASD resumes. No console errors. Mobile 390×844 no document horizontal overflow; desktop 1366×768. Screenshots: `/tmp/forest-overnight-p04-{mobile,desktop}.webp`.
- Node 14/14, Python 3/3, all JS syntax and diff checks pass.

### P0.5 — Atomic application of parsed saves (2026-10-30)

- Regression test reproduced a real partial-restore bug: a JSON save with a valid seed/felled list but invalid damage value raised a parse error **after** overwriting in-memory seed/felled, leaving a mixed world.
- `World.__init__` now parses seed, felled, damage and logs into locals and assigns the complete state only after parsing succeeds. The save schema, on-disk file and write logic are unchanged.
- A temporary `test_world.py` case verifies an invalid save starts from a clean, randomly seeded world instead of mixing in partial persisted values.
- Validation: Python 4/4, Node 14/14, Python compile and diff checks pass. No real saves touched.

### P1.1 — Local toasts for gameplay feedback (2026-10-30)

- Added `src/notifications.js`: a small unobtrusive DOM notification manager with `info`, `success`, and `warning`, max three visible, 1.2s key-based deduplication, automatic dismissal, bounded dedup cache, `aria-live` status, CSS transitions and reduced-motion support. It intercepts no pointer events.
- Both HTML clients share the new module through `main.js`; no new framework, build step or dependency. Connected building errors, offline placement/removal, actual offline tree reward, and server-confirmed multiplayer placement, removal, and tree-fell rewards; unexpected disconnection gets a warning.
- A success toast is intentionally **not** emitted on sending an online action, only upon authoritative server reply.
- Added `tests/notifications.test.mjs`: simultaneous toast cap, repeated-message suppression, expiry/fade cleanup, bounded event history. Building test now also asserts that online placement has no optimistic reward notification.
- Browser isolated debug: desktop 1366×768, mobile 390×844 with reduced motion, visible invalid-place warning, zero network/JS errors, mobile toast position adjusted to avoid all main buttons. Screenshots `/tmp/forest-overnight-toast-desktop.webp` and `/tmp/forest-overnight-toast-mobile-final.webp`.
- Full suite: Node 17/17, Python 4/4, JS syntax and diff check pass.

## Validation

- Initial Python baseline: 1 test passed; initial JS syntax check passed.
- P0.1: Python unittest 1/1 passed; JS `node --test tests/resources.test.mjs` 2/2 passed; `node --check` for `src/*.js` passed.
- P0.2: Python unittest 1/1 passed; JS `node --test tests/*.test.mjs` 11/11 passed; JS syntax and `git diff --check` passed.
- Isolated browser test: page loaded with WebGL2, `window.__gameDebug` available in debug page; no errors after fixing one syntax issue caught during development.
- No changes made to world seeds, tree IDs, saved world format, bot or network protocols.
- Visual quality/subjective game feel was not assessed by a human.

## In progress / next

- P0.4 — Polish keyboard/chat and touch UX.
- P1 — Notifications, hit feedback, hints, and quality-of-life when P0 is stable.

## Git

Small task-scoped commits on `overnight`. Detailed commit bodies include the checks performed. No push.
