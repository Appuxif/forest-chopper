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

- Completed through this pass: P0.6 local diagnostics, P0.4 tutorial/HUD overlap, P2.1 wind, P2.2 trail/signs, P2.3 decorative campfire and P2.9 camera FOV; previous P1.9–P1.12 milestones are also complete.
- Automated coverage now: 48 JavaScript and 5 Python tests; isolated desktop/mobile browsers verified. Existing `.codex/` remains untouched.
- Remaining candidates: P2.4 optional day/night lighting, subjective mobile touch UX review and P2.8 cooperative map pings. Do not implement network-authoritative crafting, saplings or economy without separate protocol/save design and end-to-end tests.
- No push/deploy, real world save or public multiplayer changes.



### P1.10 — Multiplayer presence, connection state, and safe reconnect (2026-10-30)

- Added brief, deduplicated toasts for real remote player join/leave; no historical player flood after `welcome`, and duplicate join/leave messages do not repeat toasts.
- Top HUD now shows amber `Подключение…` during direct WebSocket or PeerJS setup, correct Russian singular/plural counts for connected players, and returns to an explicit offline state after disconnect/failure.
- Hardened WebSocket lifecycle: stale socket event handlers are detached on disconnect/reconnect, and incoming messages / hello / errors are ignored if the WebSocket is no longer the active one. Old rooms cannot populate an unrelated newly connected world.
- Two new `tests/multiplayer-ui.test.mjs` cases simulate welcome, real join/leave, duplicate delivery, avatar cleanup and reconnect races without network dependencies.
- Browser E2E on isolated `127.0.0.1:18942` temporary-world server: joined via real browser WebSocket, second guest joined and left. Verified `2 игрока → 1 игрок`, matching join/leave toasts, no errors, and no stale avatar. Repeated in 390×844 touch emulation. Screenshots: `/tmp/forest-overnight-p110-desktop.webp`, `/tmp/forest-overnight-p110-mobile.webp`. Browser emulation reloads the page, so mobile guest check was executed after rejoining.
- Validation: Node tests 34/34; Python tests 5/5; all JS syntax, Python compilation and `git diff --check` PASS. No protocol changes, live game save untouched, no push.

### P1.11 — Deterministic tree silhouette variation (2026-10-30)

- Added three lightweight procedural canopy outlines: existing conifer, narrow/tall fir, and broader/flatter pine. Exactly four foliage meshes and one trunk remain per tree; all geometry/material references are shared.
- Only appearance changes: tree IDs, seed sampling indices for location/HP/height/trunk scale, world save, trunk collision, and headless bot rules are untouched. Separate visual random index 701; no new geometry, new shader, textures, or runtime animation.
- Regression `tests/resources.test.mjs` checks 90 sampled tree shapes for determinism after unload/rebuild, exact original HP/height/scale/positions, full three-variant distribution, five shared meshes, and zero extra resource allocation.
- Real isolated browser `index_debug.html`: 387 loaded trees split into 135 standard / 113 slender / 139 broad; each has exactly 5 meshes; renderer geometries remained 63. Tested at mobile 390×844 and desktop 1366×768 with no console warnings/errors. Screenshots `/tmp/forest-overnight-p111-{mobile,desktop}.webp`.
- Validation: Node 35/35; Python 5/5; JS syntax and `git diff --check` PASS. Visual appeal remains a subjective human review item. No push.

### P1.12 — Flowers and mushrooms among chunk decorations (2026-10-30)

- Introduced two lightweight shared low-poly meshes (small golden flower and reddish mushroom). Each is substituted for a deterministic subset of existing grass decorations, not added on top of them; each chunk still has exactly 25 decoration meshes.
- Trees, tree IDs, HP, positions, rock locations, buildable logs, collision, seed compatibility, multiplayer messages, and server save are unchanged. Flora is purely decorative, has no collision or fake collection affordance.
- Added a resource regression covering 14 chunks: same seed and coords reproduce exact flora types/scales/positions, flowers and mushrooms both occur, grass remains the majority, and no per-decoration GPU allocations happen.
- In the real browser with 49 loaded chunks: 762 grass, 183 rocks, 216 flowers and 64 mushrooms; all chunks remain at 25 meshes and renderer geometry count increases only by the two globally shared primitives (63 → 65). Desktop 1366×768 and mobile 390×844 both loaded without console errors. Screenshots `/tmp/forest-overnight-p112-{desktop,mobile}.webp`.
- Validation: Node 36/36, Python 5/5, all source JS syntax and diff checks PASS. Visual taste remains a human review item. No push.

### P2.7 — Rare frosty trees (cosmetic only) (2026-10-30)

- Added ~1.5% seed-deterministic pale frosty trees. All rare trees reuse a single shared foliage material across four leaves; no extra meshes or geometry. Trunk position, scale, tree HP/ID, seed, physics and multiplayer reward remain identical.
- The rarity decision uses a fresh deterministic random index (702), independent from existing world/server indices and the three basic silhouette variants. Rare trees have no extra resource reward or collection mechanic.
- New regression tests generate 600 trees twice to validate rarity and reconstruction, unchanged HP, shared material and geometry.
- Isolated debug browser: 7 frosty trees among 387 loaded trees, all shared one foliage material `#b1ced2`, every tree still exactly five meshes, geometry count unchanged at 65. Chrome mobile 390×844 and desktop 1366×768 were exercised, console clear. Screenshots `/tmp/forest-overnight-p27-{mobile,desktop}.webp`.
- Validation: Node 37/37, Python 5/5, JS syntax and diff checks PASS. No push.

### P1 follow-up — Birch trees with white bark and rounded crowns (2026-10-30)

- Added a new deterministic visual tree species (`species:'birch'`) for approximately 20% of existing tree slots, selected from unused procedural seed index 703. Existing tree coordinates, IDs, height/scale random channels, HP, hit cooldown, wood rewards, collision and multiplayer/save formats remain unchanged.
- Birch trunks use the existing shared cylinder geometry at a slightly slimmer cosmetic width, one globally shared Lambert bark material and one shared procedurally drawn CanvasTexture. The texture contains fixed short dark bark streaks; hitting a birch does not create or expand rectangles, flash, or mutate the bark material.
- Canopies use one shared low-poly icosahedron geometry with three shared light-green materials. Exactly four offset, rounded foliage lobes plus one trunk per tree: still five meshes, no per-tree geometry/material/texture allocations. Rare frosty trees retain the existing palette override without losing species identity.
- Aiming at a birch labels the health HUD `🌳 Берёза`. Both HTML entrypoints and relevant JS import URLs were versioned (`20261030-birch`) to avoid stale cached tree/player code on mobile devices.
- New deterministic resource test generates 450 trees, verifies birch/normal distribution, original HP/IDs/world positions/trunk scales, shared geometry/materials, reproducible silhouettes after unload/rebuild and damaged birch HP restoration.
- Real isolated desktop browser: initial seed yielded 86 birches among 390 trees; birch trunk uses a shared CanvasTexture, four `IcosahedronGeometry` lobes, and exactly five meshes; renderer initially used 66 geometries/59 textures after render (one new shared tree geometry and one shared bark texture). Navigated to a live birch, aimed, chopped once (HP 10→9), verified unchanged trunk material/texture/scale, and restored the same birch with HP 9 after reloading the isolated offline save. Dynamic `Берёза` label verified. Debug browser had one unrelated missing resource (404, likely favicon), no application JavaScript exception.
- Normal `index.html` tested in 390×844 mobile/touch emulation with reduced motion: WebGL loaded, mobile controls present, debug API absent, and no console errors. Screenshots in `/tmp/forest-overnight-birch-{desktop,mobile}.webp`.
- Validation: Node 38/38, Python 5/5, `node --check` on all client modules, Python compile, and `git diff --check`. No push; user world/server unaffected.

### P0.6 — Opt-in local renderer diagnostics (2026-10-30)

- Extended the existing `FPS` checkbox to `FPS и диагностика рендера (локально)`. Once enabled, the small HUD updates approximately once a second and shows FPS, ping/offline, renderer draw calls/triangles, GPU geometry/texture counts, loaded chunks/trees and live chip particles.
- `src/diagnostics.js` only reads the local Three.js renderer and existing in-memory collection sizes. Metrics are never sent over the network, saved to localStorage, logged, or sampled when the checkbox is disabled. Existing saved preference shape (`mouseSensitivity`, `showFps`) and world saves remain unchanged.
- Tests cover accurate/fallback metric collection, no data leaks from other ctx properties, and throttled HUD updates/disabled state/storage not containing stats.
- Real isolated browser: desktop debug showed `FPS 31 · offline / Draws 970 · Tri 50490 · Geom 66 · Tex 59 / Chunks 49 · Trees 389 · FX 0`; 390×844 touch viewport placed the 61.5-pixel HUD entirely inside the viewport without crossing movement/chop/build buttons, and browser console contained no errors. Screenshot `/tmp/forest-overnight-diagnostics-mobile.webp`.
- Validation: 40/40 Node tests, 5/5 Python tests, JS syntax and `git diff --check`. Both HTML entrypoints and relevant module URLs versioned `20261030-diagnostics`. No push.

### P2.1 — Gentle low-cost forest wind (2026-10-30)

- Added `src/wind.js`: a subtle deterministic sine-wave sway of *foliage only*, preserving trunk rotations, materials, HP, raycast collision and all original birch crown yaws. Tree IDs, world/save/network protocol are unchanged. It animates at most 32 trees within 24 meters, with a throttled update every 150 ms; no new mesh/materials, per-frame geometry allocations, or growing particle arrays.
- On chunk unload, felled tree, player movement, world reset or multiplayer world replacement, previously active leaves are restored to their original rotations, and stale tree references are released. Reset hooks clear active wind immediately.
- Settings now offer `Лёгкий ветер в кронах` (on by default, stored in existing settings key with backward-compatible parsing). The system `prefers-reduced-motion: reduce` preference overrides the setting to stop wind automatically, including mid-session, with no additional listeners/timers.
- Added `tests/wind.test.mjs` covering nearby cap, fixed trunks/birch orientation, unchanged GPU resources, frame throttle, reset/eviction, player setting and reduced-motion transitions; settings tests verify sanitized persistence.
- Isolated real Chrome browser: at 390×844 touch resolution with reduced-motion emulation, no nearby crowns moved. Switched to no-preference and verified 104/104 nearby leaf rotations changed while trunks remained fixed; unchecking wind restored every leaf to the exact neutral rotation and saved `windEnabled:false`. Normal `index.html` mobile with wind enabled loaded with no debug API or JS errors. Desktop 1366×768 also loaded without console errors. Screenshots `/tmp/forest-overnight-wind-{mobile,desktop}.webp`.
- Validation: 43 Node tests, 5 Python tests, JS syntax checks and diff checks pass. No push; test world and network saves untouched.

### P2.2 — Forest trail and directional signs (2026-10-30)

- Added `src/landmarks.js`, a decorative, noninteractive west-east trail along world `z=0`. Each active trail chunk gets exactly one flat, shared 24×3.2 m earth-colored quad. No world geometry edits, tree spawn changes, collisions, physics or server messages.
- Every third trail chunk is eligible for a simple wooden sign pointing toward the original spawn area `(0,0)`. A deterministic candidate search avoids positions within 3m of seeded tree trunks, including already felled trees; both directions reuse two shared sign textures and the same pole/board geometries and materials. Chunks have only the existing 25 flora meshes plus one trail mesh and at most one two-mesh signpost.
- New `tests/landmarks.test.mjs` checks continuous path coverage across 15 chunks, deterministic sign positions and direction, shared materials/textures, no additional per-chunk allocations, 25 normal decoration items, and no disruption to seeded trees.
- Real isolated Chrome debug page: 49 chunks yielded 7 trail segments, 3 signposts and 3 boards. Walked from origin to sign near `x=12,z=4.8` and visually verified visible path and readable board. Screenshot review exposed unrelated existing FPS/tutorial HUD overlap; separate P0.4 fix queued.
- Normal mobile `index.html` tested at 390×844 with touch controls: scene loads, module version updated, no debug API, console error/warning count zero. Screenshot `/tmp/forest-overnight-landmarks-mobile.webp`. No gameplay/save/protocol schema changes and no push.

### P0.4 follow-up — Keep diagnostics off active onboarding text (2026-10-30)

- During desktop visual verification of P2.2, found an actual overlap: optional `FPS/diagnostics` panel at `top:320px` covered the first-run onboarding panel above `bottom:300px`, hiding some tutorial text.
- Added a single responsive CSS rule in `src/settings.js`: when `.fc-tutorial` is visible, temporarily hide the diagnostics HUD. On tutorial skip/completion the same diagnostic HUD automatically reappears if the user enabled it; FPS sampling and persisted preference are unchanged. The settings control has a tooltip explaining the temporary behaviour.
- Real browser desktop 1366×768 verified `tutorialVisible=true → computed FPS display:none`, and after Skip `tutorialVisible=false → display:block`. Real mobile 390×844 showed the same transition with no overlap, no console warnings/errors. Screenshot `/tmp/forest-overnight-hud-no-overlap-mobile.webp`.
- No game state, protocol, save, settings schema or shader changes; minimal CSS-only UI correction. No push.

### P2.3 — Decorative campfire at the trailhead (2026-10-30)

- Added one static campfire at `(5,0,5)` in world chunk `0,0`. It has six shared-geometry stones, three logs using the existing game log material/geometry, two shared-geometry low-poly orange/yellow flames, three tiny embers from the existing shared octahedral flower geometry, and one low-radius warm PointLight. No player action, crafting recipe, wood cost, interaction prompt, collision or network/save/protocol changes.
- Its gentle flame and light oscillation runs through the existing game render loop at most once per 150 ms, never creates a new mesh/material/texture per update, and stops immediately (restoring baseline) under `prefers-reduced-motion: reduce`. When the origin chunk unloads, no campfire object reference is kept.
- Expanded `tests/landmarks.test.mjs`: unique origin campfire and exact child count, reuse of rock/log assets, no change to tree/seed/felled state or growing resources, unloading, throttled flicker, range of light intensity and dynamic reduced-motion handling.
- Real isolated debug Chrome at mobile 390×844: exactly one campfire with 15 children positioned at `(5,0,5)`, flame y-scale changed gently over time and PointLight intensity was ~0.64; renderer memory remained bounded (69 geometries, 60 textures in initial measurement). Emulated reduced motion: scale restored to 1 and intensity 0.65, with no damage/wood/cuts changes. Visually inspected warm flame, stone ring and logs. Normal `index.html` touch/mobile loaded with no console errors and no debug API. Screenshot `/tmp/forest-overnight-campfire-mobile.webp`.
- Full test suite validated before commit; no push and no writes to production world save.

### P2.9 — Persistent camera FOV slider (2026-10-30)

- Added `Угол обзора (FOV)` to Settings, a simple 65–95° slider in 5° steps (default 75°) for both first-person and third-person cameras. Adjusting it calls `camera.updateProjectionMatrix()` immediately without reloading or changing movement/collision.
- `sanitizeSettings` bounds/rounds persisted FOV, keeps the existing versioned `forest-chopper:settings:v1` key, and accepts older saved preferences with no FOV field as 75°. Reset Settings restores 75°. No world save or networking protocol is touched.
- Extended `tests/settings.test.mjs` with sanitization boundaries and a realistic Settings DOM/callback test validating initialization with saved 85°, live change to 95°, persistence, callback order and reset to 75°. Updated diagnostics storage test for the expanded preference.
- Real isolated debug Chrome touch 390×844: FOV 75→95 immediately changed the perspective projection matrix element 2.82→1.98 with wood unchanged; reloading restored 95°, and Reset returned FOV 75°/projection matrix 2.82. Normal `index.html` mobile rendered with FOV slider and without debug API or console errors; desktop 1366×768 had no warnings/errors. Screenshot `/tmp/forest-overnight-fov-mobile.webp`.
- Full test suite validated before commit; no push.

### P2.4 — Optional local day/night lighting cycle (2026-10-30)

- Added a lightweight local-only eight-minute day → dusk → night → dawn cycle to the existing Three.js background/fog and two shared lights. Daytime remains the original palette. Night brightness is deliberately capped to keep trees, paths and player readable (hemisphere ≥1.35 and directional ≥0.65). No mesh, shader, texture, collider, shadow caster or world-generation changes.
- New Settings checkbox `Локальная смена дня и ночи`, **off by default**, with explicit note that multiplayer clients have independent visual time. Existing `forest-chopper:settings:v1` values migrate to disabled; Reset restores normal daytime. Reduced-motion preference immediately disables the animated cycle and restores exactly the original colors/intensities.
- New `src/day-cycle.js` uses a small reusable color palette, throttles interpolation to 300 ms, and maintains no per-frame GPU allocations. Pure phase interpolation and actual controller are covered by four tests: smooth wrapping/brightness floor, opt-in and live reset, reduced-motion override and continuity across dusk/dawn. Existing settings tests validate boolean sanitization and persistence.
- Real isolated Chrome debug client: default bright sky `#a4c8be`, simulated actual night phase `#506685` with fog matching, hemisphere 1.35 and sun 0.65; desktop and 390×844 touch screenshot confirm HUD stays readable, no JavaScript errors. Actual checkbox was toggled on/off and persisted; normal mobile entrypoint loaded without debug API or console warnings. Screenshot `/tmp/forest-overnight-daycycle-night-mobile.webp`.
- Tests: Node 52/52, Python 5/5, all client syntax and diff checks PASS. Local save and server protocol unchanged; no push.

### P2.9 follow-up — Optional automatic sprint while moving (2026-10-30)

- Added `Автобег при движении` to the existing settings, disabled by default and saved under the same backward-compatible settings key. When enabled, any actual movement input (keyboard arrows/WASD or touch joystick) uses the existing Run root-motion/fallback speed; at rest the player remains idle. Shift continues to work regardless of the preference.
- Extracted pure `shouldSprint(keys, autoSprint, moving)` used by `src/player.js`; no new controls, protocol fields, animation assets, speed constants or changes to physics/collision.
- Two new Node tests validate manual Shift sprint, idle behavior, touch/keyboard auto sprint, opt-out and preference sanitization. Settings/diagnostics regression tests verify checkbox persistence and Reset behavior.
- Real isolated Chrome on touch 390×844: moving forward for 900ms covered approximately 1.10m with auto sprint off and 2.67m with it on (2.42× in this short root-motion sample; not a guaranteed movement multiplier), without holding Shift. Normal mobile `index.html` loads with auto sprint initially disabled, no debug API and no console errors. Screenshot `/tmp/forest-overnight-autosprint-mobile.webp`.
- Validation: Node 54/54, Python 5/5, source JS syntax and `git diff --check` PASS; no production world/server changes and no push.

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
