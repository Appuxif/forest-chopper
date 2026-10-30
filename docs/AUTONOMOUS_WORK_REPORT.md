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

### P1.2 — Confirmed chopping feedback (2026-10-30)

- New `src/hit-effects.js`: a shared golden hit-flash material (only one material for the entire session) and short-lived visual trunk pulse. Restores each tree's original shared material and scale when the effect expires or a tree is removed. Reduced-motion viewers see a color flash without movement.
- Visual feedback starts with `spawnChips`, which is used on confirmed offline hits and authoritative online `tree_hit` events. Added chips to authoritative online `tree_fell` (the final blow), without changing health or reward rules.
- Capped active chips at 96 across all hits; existing per-frame particle cleanup still removes expired chips. Animation tick and chunk/reset disposal also clear active tree hit effects.
- `tests/hit-effects.test.mjs` verifies 100 concurrent hits share a single material, proper restoration and idempotent release, reduced motion, and particle cap. Full suite now Node 20/20 + Python 4/4.
- Isolated browser with actual rendered tree: hit effect module changed its trunk material, used no additional geometries, then restored the original; console errors zero. Subjective impact on chopping remains to be human-reviewed.

### P1.4 + partial P1.5 — Local preferences and FPS HUD (2026-10-30)

- New `src/settings.js` creates a compact settings menu shared by normal and debug HTML clients. It provides view sensitivity 0.4–2.5 (applies to mouse/touch camera movement), FPS visibility toggle, and reset to defaults; values are stored independently under `forest-chopper:settings:v1` in `localStorage` with parse-error fallback and strict validation.
- Enabling FPS starts a lightweight 950ms rolling frame count. HUD is hidden when disabled and never fabricates a network ping. **Network RTT part of P1.5 remains outstanding.** Opening settings closes the network panel and vice versa.
- `tests/settings.test.mjs` validates defaults, corrupted values, boundaries, and rejection of unrelated world fields.
- Isolated browser validated mobile 390×844 and desktop 1366×768, persisted sensitivity=1.7 and FPS flag on reload, actual camera yaw change matching sensitivity, FPS display updates, no scrolling or console errors. Screenshots `/tmp/forest-overnight-settings-{mobile,desktop}.webp`.
- Full suite: Node 22/22, Python 4/4, JS syntax and diff checks pass.

### P1.5 — Live network RTT over WebSocket (2026-10-30)

- Added lightweight application-level `ping` / `pong` (bounded integer nonce) to the regular human WebSocket handler. Pong replies only to the requesting connection; not broadcast and not written to saves. Existing message types and bot path are preserved.
- Client sends at most one outstanding ping every ~5s, times out after 12s and clears stale metrics; RTT measured from browser `performance.now()`. The display is deliberately labelled `Ping`, i.e. round trip through the active connection (including PeerJS bridge if used), not raw WebSocket control-frame latency.
- Existing optional FPS HUD now includes `Ping —` while awaiting the first response and `offline` when disconnected. It never shows a fabricated latency value.
- Python test covers echo nonce, rejection of malformed/negative values and no broadcast to a second client.
- Isolated temporary localhost world server: desktop FPS HUD displayed `Ping 8 ms`; mobile 390×844 after reconnect displayed `Ping 5 ms`, and manual disconnect immediately changed HUD to `offline`. No JS console errors. Mobile screenshot `/tmp/forest-overnight-ping-mobile-confirmed.webp`.
- Full suite: Node 22/22, Python 5/5, JS syntax and diff checks pass. No production server or save touched.

### P1.6 — Versioned offline world saves (2026-10-30)

- New `src/offline-save.js` persists **only offline games** under `forest-chopper:offline-world:v1` in browser localStorage. Saves seed, felled IDs, damaged tree HP, all placed logs, wood/cut counters and position including height and camera angles. Stored content is versioned, bounded (~1.5 MB) and validated before any restore action.
- After restoring, existing deterministic tree chunk IDs remain unchanged. Offline chopping now updates `treeDamage` while trees are damaged and clears that entry when felled, so chunk unload/reload keeps partial hits. Offline place/remove schedules save. Player movement autosaves periodically (~15 seconds) and final state is saved on `pagehide`; changes use a 900ms debounce.
- `New forest` clears the offline save immediately, clears stale tree damage and starts a new seed; the fresh world can then autosave.
- On authoritative online welcome, the last offline snapshot is flushed and autosave is suspended. The server world **never** overwrites it. After disconnect, the in-memory copy of the online world can still be played but is **not locally saved**; the network panel explicitly warns to start `New forest` to resume offline saving. Reloading restores the previous offline save.
- `tests/offline-save.test.mjs` covers round-trip restore of trees/logs/wood/position/y, invalid data, limit checks, and multiplayer suspension/reset. Browser isolated debug: walked ~3.2 m, reloaded and preserved position; joined an isolated WebSocket world, confirmed offline seed/snapshot untouched while moving in multiplayer, disconnected/reloaded and recovered the offline position; then reset confirmed old save cleared and a new seed/save created. Normal `index.html` loaded with no debug API. No console errors.
- Validation: Node 25/25, Python 5/5, JS syntax, Python compilation and diff checks PASS. Real server/world files were not touched.

### P1.7 — Three-step first-run onboarding (2026-10-30)

- Added `src/tutorial.js`, a small nonblocking panel for: approach and aim at a tree, actually fell a tree, then actually place a log. Prompts switch between keyboard and touch wording. A Skip button persists the dismissal; completing all three hides the panel and shows a single success toast.
- Progress is driven strictly by existing real game events (aimed-tree raycast, successful offline fall/server-confirmed own tree fall, successful offline place/server-confirmed own log_add). No timer-based or fabricated completion. It persists only under `forest-chopper:tutorial:v1` and does not interfere with world saves.
- `tests/tutorial.test.mjs` verifies stage ordering and rejected irrelevant events; existing building mock updated for the tutorial hook.
- Isolated browser end-to-end: fresh debug player navigated to a tree and aimed, step 1→2; chopped the same tree with 11 real hits, step 2→3 with +5 wood; placed one actual log, stage 3 completion, wood=4 and completion toast; reload remained completed. Separate 390×844 touch context verified the panel did not overlap main buttons and Skip persisted after reload. No browser console errors. Screenshot `/tmp/forest-overnight-tutorial-mobile.webp`.
- Full suite: Node 26/26, Python 5/5, JS syntax and git diff checks pass.

### P1.8 — Local lifetime statistics and achievements (2026-10-30)

- Added `src/progress.js`: lightweight local-only progress panel with felled trees, placed logs, walked distance, seed-scoped unique chunks, and nine milestones (1/5/20/100 trees, 1/10 logs, 100/1000 m, 10 chunks). Unlocked achievements are derived from persisted counters, so they never toast twice after page reload. The panel explicitly labels stats `Локально` and makes no server-authoritative claims.
- Counters update only from successful offline actions or authoritative own-player network messages; log placement is **not** counted when an online request has only been sent. Movement ignores teleports/deltas above 4 m and resets its baseline on world reset or welcome; chunks use world seed + coords to avoid false re-exploration across reloads.
- Stats saved in a separate bounded/validated `forest-chopper:progress:v1` key, debounced and flushed on pagehide, independently from game saves/tutorial settings. UI is optional via `🏅 Прогресс` button and coexists with settings/network panels.
- New `tests/progress.test.mjs` tests one-time unlock, persistence without duplicate notifications, accurate movement, anti-teleport skip, chunk uniqueness and invalid data. Building tests assert online placement cannot earn an achievement before server ack.
- Isolated browser real gameplay: walked ~3.12 m and visited two chunks with counters persisted; felled a tree in seven confirmed hits -> `Первое дерево` unlocked; placed a real log -> `Начинающий строитель` unlocked; reload retained both achievements with no duplicate toasts. Mobile 390×844 progress panel fits viewport, nine milestones shown, console errors zero. Screenshots `/tmp/forest-overnight-achievements-{mobile,desktop}.webp`.
- Validation: Node 29/29, Python 5/5, JS syntax and diff checks pass.

## Validation

- Initial Python baseline: 1 test passed; initial JS syntax check passed.
- P0.1: Python unittest 1/1 passed; JS `node --test tests/resources.test.mjs` 2/2 passed; `node --check` for `src/*.js` passed.
- P0.2: Python unittest 1/1 passed; JS `node --test tests/*.test.mjs` 11/11 passed; JS syntax and `git diff --check` passed.
- Isolated browser test: page loaded with WebGL2, `window.__gameDebug` available in debug page; no errors after fixing one syntax issue caught during development.
- No changes made to world seeds, tree IDs, saved world format, bot or network protocols.
- Visual quality/subjective game feel was not assessed by a human.

## In progress / next

- Finish any remaining P0.4 subjective touch/UI review and P0.6 optional diagnostics.
- P1.9 compact objectives.
- P1.11/P1.12 cosmetic world variety and P1.10 multiplayer join/leave polishing.
- P2 stretch mechanics only after stable P1; no push/deploy.

## Git

Small task-scoped commits on `overnight`. Detailed commit bodies include the checks performed. No push.

### Follow-up — Localize the axe hit highlight (2026-10-30)

- Player feedback: the entire tree trunk was flashing gold on hit because `hit-effects.js` temporarily swapped the whole trunk's shared material and inflated its width for 150 ms.
- The feedback now brightens only the existing per-tree scar material for 150 ms and gently expands that small scar (unless reduced motion is requested). Tree trunk material and trunk scale never change. The original scar color/width are restored, including on repeated hit or chunk release. This allocates zero new materials per impact and leaves chips, HP, rewards, and networking untouched.
- Automated tests verify 100 concurrent active scars without allocating materials; trunk state unchanged during and after pulse; reset/idempotent release; reduced-motion behavior and 96-chip cap.
- Isolated Chrome debug page with real Three.js tree: trunk material identity stayed unchanged while only scar color temporarily changed; original scar color restored, active effects returned to zero and renderer geometries stayed 63. No human aesthetic assessment claimed.
- Regression suite: Node 30/30, Python 5/5, all source JS syntax, `git diff --check`: passed. The phone-facing HTTP server on LAN port 18742 remains untouched; refreshing the browser loads updated code.

### Follow-up 2 — Eliminate all transient tree flashing after mobile feedback (2026-10-30)

- User still saw the entire trunk blink after the previous scar-only flash patch. Verified that the LAN-facing HTTP server serves the updated source, and reproduced a real offline hit through the debug browser to inspect material/scale/rotation changes.
- Found two remaining visible sudden changes: the 150 ms golden scar recolor and an independent random `tree.rotation.z` change at every offline hit. Removed BOTH completely. Persistent scar damage, bounded wood chips, axe animations, HP/rewards and authoritative multiplayer confirmation remain.
- Removed hit-effects polling and runtime effect allocations. `src/hit-effects.js` is now an inert compatibility shim for older cached modules; current `chopping.js` does not import it.
- Cache bust: both HTML entrypoints now reference `main.js?v=20261030-no-flash2`, and main imports revisioned chopping/player modules. The new URL query `?fix=20261030-no-flash2` also avoids a cached HTML document on mobile. LAN web server stays up without restart.
- Added regression checks for unchanged trunk material/scale/rotation, unchanged scar color, wood-chip output and cap, online pre-ack behavior, and inert legacy effect compatibility.
- Real browser via `http://192.168.1.147:18742`: verified versioned module URLs, then approached an actual tree and hit it. HP 9→8, scar stayed the same color, trunk material/scale and group rotation stayed identical immediately and after 100 ms, and scar remained visible. Mobile 390x844 rendering and normal entrypoint (no debug API) loaded without console warnings/errors.
- Checks: Node 31/31, Python 5/5, all src JS syntax, Python compilation and git diff checks PASS. This confirms removal of the implemented flash; actual phone-browser rendering remains a user acceptance check.

### Follow-up 3 — Remove growing rectangular damage overlay (2026-10-30)

- User reported a rectangle growing on the trunk with repeated hits. Root cause: every tree owned a horizontal `PlaneGeometry(.75*scale,.22)` scar, which was made visible on impact and stretched vertically according to `1 + (1 - hp/maxHp)*2.2`. This rendered as a flat rectangular slab, especially when viewed obliquely.
- Removed creation of the scar plane/material from `src/world.js`. Removed scar scaling/toggling from local `chopping.js` and authoritative online `treeHit` in `multiplayer.js`. Raycasting now targets the tree's real children only.
- Removed obsolete per-tree `disposeTree` calls and associated plumbing because all remaining trunk, foliage and decoration geometry/materials are shared. The tree HP/damage save format, tree IDs, tree generation random calls, chips, tree fall, and log rewards remain unchanged.
- Updated tests: 130 chunk cycles verify exactly five tree meshes (trunk + four foliage), no per-tree material/geometry allocation; damaged-tree reload reconstructs correct HP without a scar; offline and online pre-ack tests confirm no rectangle while keeping chip effects.
- Browser-tested on the actual LAN HTTP address `http://192.168.1.147:18742` with new module revision `20261030-no-scar3`. Confirmed real offline chop 8→7 HP and seven chips with five mesh children and no PlaneGeometry; reloaded saved offline game and HP 7/8 was restored with no overlay. Normal entrypoint loaded at 390×844 touch viewport, no debug API or console errors. This did not touch the live multiplayer world or user browser tabs.
- Validation: Node 32/32, Python 5/5, all JS syntax, diff checks. Browser module error encountered during development from missing semicolons in compressed loops was fixed and re-verified after reload. No push.
