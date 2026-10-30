// Local rendering counters only; never sent or stored. Read at most once per FPS sample.
const count = value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

export function collectDiagnostics(ctx) {
  const renderer = ctx?.renderer?.info;
  return {
    draws: count(renderer?.render?.calls),
    triangles: count(renderer?.render?.triangles),
    geometries: count(renderer?.memory?.geometries),
    textures: count(renderer?.memory?.textures),
    chunks: count(ctx?.chunks?.size),
    trees: count(ctx?.trees?.size),
    particles: count(ctx?.particles?.length),
  };
}

export function formatDiagnostics(stats) {
  const s = stats;
  return `Draws ${s.draws} · Tri ${s.triangles} · Geom ${s.geometries} · Tex ${s.textures}\nChunks ${s.chunks} · Trees ${s.trees} · FX ${s.particles}`;
}
