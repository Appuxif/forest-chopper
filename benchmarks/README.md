# Offline-save FPS benchmark (debug only)

This is intentionally **not** a separate world generator. The 500-, 1000-, 1500-, and 3000-box fixtures are
an ordinary single-player version-1 world save, with a fixed seed, position and
500/1000/1500/3000 precisely located ordinary dropped-item boxes.

- Seed: `517013`
- Player: `(288, 272)`, camera faces the boxes at about `(288, 288)`
- 500, 1000, 1500, or 3000 individual boxes (stones, one per box) at fixed grid coordinates, all using the same central test footprint
- All `expires_at: 0` are **placeholder values in the fixture file only**:
  the debug loader rewrites them to `now + 3600 seconds` before parsing.
- The benchmark runs on preset `medium` with the game FPS cap (60 FPS).

## Manual browser procedure

Open `index_debug.html`, start a **single-player** game, then in DevTools:

```js
await __gameDebug.loadBenchmarkSave('/benchmarks/box-stress-1000.json');
// or '/benchmarks/box-stress-1500.json' or '/benchmarks/box-stress-3000.json'
__gameDebug.startBoxBenchmark({
  warmupMs: 10000, measureMs: 10000, settleMs: 5000
});
```

Wait for `__gameDebug.benchmarkStatus().status === 'completed'`,
then inspect:

```js
__gameDebug.benchmarkStatus()
__gameDebug.fpsSamples()    // capped at the last 120 full 1-second windows
__gameDebug.lootStats()
```

The runner first **removes the boxes** for the no-boxes baseline, warms the
already loaded forest, measures 10 s, then loads the selected 500/1000/1500/3000 boxes into the
same position, allows settling, and measures 10 s. Stats include per-second
render FPS, per-frame p95/p99 frametime within each window, average draw calls,
triangle count and JS heap memory when available.

**Player save safety:** `loadBenchmarkSave()` suspends saving without flushing
the current game and replaces only the in-memory world. It never writes the
benchmark to the player's normal offline save. **Reload the page** to return
to the previously saved ordinary world.

This is a **DEBUG-only**, renderer-dependent benchmark, not an objective
cross-GPU score. Compare different versions using the same GPU, resolution,
browser, preset, background tasks and orientation. A 60 FPS cap can conceal
improvements in GPU headroom.

## Fixture extension

Edit `box-stress-500.json` as an ordinary save file (structures, placed logs,
item boxes, felled trees, position, etc.). When adding an object, ensure that
its ID and shape comply with the same save parser as real single-player worlds.
Changes should be reviewed against a stable seed and map coordinates.

## Scaling runs
The 1000-, 1500-, and 3000-box fixtures keep the **same seed, camera position, view
direction, area, item type, and Medium preset**; only box count and placement
density change. Use the same benchmark timing as the 500-box baseline.
Results go in `benchmarks/results/`.


## Intel Iris Xe — 3000 boxes, High preset (2026-11-02)
- Result: **56.14 FPS baseline → 55.39 FPS with 3000 boxes** (−0.75 FPS, −1.3%), at 1920×905 / High render scale 100%.
- Average draw calls: 906 → 910; triangles: 3,261,111 → 3,297,111.
- The repeat run followed a longer initial warmup to avoid world streaming changing the scene mid-comparison. Earlier High run (54.90 vs 54.82 FPS) is preserved as preliminary in the same results JSON.
- Details: `results/iris-xe-high-3000-2026-11-02.json`. The Medium results use a lower render resolution and quality, so they are not a direct measure of the additional cost of boxes on High.
