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


// Read the GPU renderer once for the FPS overlay. Browsers may intentionally
// hide the real adapter (privacy/fingerprinting protection), so don't guess.
export function getGpuRendererName(renderer) {
  try {
    const gl=renderer?.getContext?.();
    if(!gl)return 'недоступно';
    const debug=gl.getExtension?.('WEBGL_debug_renderer_info');
    const unmasked=debug?.UNMASKED_RENDERER_WEBGL !== undefined
      ?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null;
    const masked=gl.getParameter?.(gl.RENDERER);
    let name=typeof unmasked==='string'&&unmasked.trim()?unmasked.trim():'';
    if(!name){
      // Masked strings such as "WebKit WebGL" aren't physical GPU names.
      if(typeof masked!=='string'||/^(WebKit WebGL|WebGL|Mozilla|ANGLE)$/i.test(masked.trim()))
        return 'скрыто браузером';
      name=masked.trim();
    }
    const angle=name.match(/^ANGLE\s*\((.*)\)$/i);
    if(angle){
      const fields=angle[1].split(/,\s*/);
      const maybeGpu=fields.length>1 &&
        !/^(D3D|Direct3D|OpenGL|Vulkan|Metal)/i.test(fields[1])
        ?fields[1]:fields[0];
      name=maybeGpu || name;
    }
    // ANGLE can append PCI IDs and API names; they aren't useful in the HUD.
    return name.replace(/\s*\(0x[0-9a-f]+\)/ig,'')
      .replace(/\s*\/PCIe\/SSE2$/i,'')
      .replace(/\s+/g,' ').trim().slice(0,120) || 'скрыто браузером';
  } catch {
    return 'скрыто браузером';
  }
}
