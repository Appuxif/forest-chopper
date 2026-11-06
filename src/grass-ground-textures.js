// Shared generator/game procedural ground tile textures.
export function createGroundMicrograssTexture(THREE, renderer, doc = document) {
  const size = 512;
  const canvas = doc.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false });
  // Deterministic, independent of the gameplay seed.
  let rng = 0x28b7c6d3;
  const random = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  ctx.fillStyle = '#688a47';
  ctx.fillRect(0, 0, size, size);

  // Broad soft color variations, toroidally wrapped to avoid tile seams.
  for (let i = 0; i < 1100; i++) {
    const x = random() * size;
    const y = random() * size;
    const radius = 8 + random() * 30;
    const oval = radius * (.7 + random() * .6);
    ctx.fillStyle = random() < .5 ? 'rgba(20,43,12,0.025)' : 'rgba(203,217,110,0.032)';
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        if (x + dx + radius < 0 || x + dx - radius > size ||
            y + dy + radius < 0 || y + dy - radius > size) continue;
        ctx.beginPath();
        ctx.ellipse(x + dx, y + dy, radius, oval, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Tiny painted blades and their shadow strokes. Average length 3–8 pixels,
  // so under the default 4m tile each mark corresponds to short micrograss.
  const shadow = ['rgba(22,53,24,.34)', 'rgba(37,68,24,.24)', 'rgba(31,56,13,.28)'];
  const highlights = [
    'rgba(157,192,91,.55)', 'rgba(196,209,119,.34)',
    'rgba(111,167,77,.62)', 'rgba(126,177,77,.51)',
    'rgba(88,141,61,.65)', 'rgba(200,185,101,.18)',
  ];
  function stroke(x, y, endX, endY, style, width) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    const xOffsets = x < 12 || endX < 0 ? [0, size] :
      x > size - 12 || endX > size ? [0, -size] : [0];
    const yOffsets = y < 12 || endY < 0 ? [0, size] :
      y > size - 12 || endY > size ? [0, -size] : [0];
    for (const dx of xOffsets) for (const dy of yOffsets) {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy);
      ctx.quadraticCurveTo((x + endX) / 2 + dx + .9, (y + endY) / 2 + dy, endX + dx, endY + dy);
      ctx.stroke();
    }
  }
  for (let i = 0; i < 26000; i++) {
    const x = random() * size;
    const y = random() * size;
    const theta = random() * Math.PI * 2;
    const length = 2.2 + random() * 6.0;
    const endX = x + Math.cos(theta) * length;
    const endY = y + Math.sin(theta) * length;
    stroke(x + .75, y + .65, endX + 1.0, endY + .75,
      shadow[Math.floor(random() * shadow.length)], .75 + random() * .5);
    stroke(x, y, endX, endY,
      highlights[Math.floor(random() * highlights.length)], .65 + random() * .62);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

// Dark woodland floor, procedurally painted into a repeating 512px canvas.
// Fallen curled leaves, pine litter, thin twigs, humus and some muted moss.
// Draw all large shapes with wrapped offsets for seamless tile boundaries.
export function createForestGroundTexture(THREE, renderer, doc = document) {
  const size = 512;
  const canvas = doc.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false });
  let rng = 0x573b1af9;
  const random = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const pick = items => items[Math.floor(random() * items.length)];
  const offsets = (v, margin) => [
    0,
    ...(v < margin ? [size] : []),
    ...(v > size - margin ? [-size] : []),
  ];
  function wrapDraw(x, y, radius, draw) {
    for (const ox of offsets(x, radius)) {
      for (const oy of offsets(y, radius)) {
        ctx.save();
        ctx.translate(x + ox, y + oy);
        draw();
        ctx.restore();
      }
    }
  }

  ctx.fillStyle = '#312d25';
  ctx.fillRect(0, 0, size, size);

  // Fine-grained soil and mulched humus.
  const pixels = ctx.getImageData(0, 0, size, size);
  const pixelsData = pixels.data;
  for (let i = 0; i < pixelsData.length; i += 4) {
    const noise = random() * 20 - 10;
    const warmer = random() * 8;
    pixelsData[i] = Math.max(0, Math.min(255, 49 + noise + warmer));
    pixelsData[i + 1] = Math.max(0, Math.min(255, 44 + noise + warmer * .45));
    pixelsData[i + 2] = Math.max(0, Math.min(255, 36 + noise));
  }
  ctx.putImageData(pixels, 0, 0);

  // Subtle, mottled dark soil; wrap patches so their edges cannot repeat
  // as a prominent horizontal or vertical seam.
  for (let i = 0; i < 730; i++) {
    const x = random() * size, y = random() * size;
    const radius = 5 + random() * 27;
    const stretch = .6 + random() * .8;
    const shade = pick([
      'rgba(8,8,5,.12)', 'rgba(93,71,43,.12)',
      'rgba(57,69,39,.12)', 'rgba(121,90,51,.065)',
      'rgba(19,28,14,.15)',
    ]);
    wrapDraw(x, y, radius * 1.5, () => {
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * stretch, random(), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Broken needles, leaf shreds and little light/dark chips in the mulch.
  for (let i = 0; i < 17000; i++) {
    const x = random() * size, y = random() * size;
    const length = .5 + random() * 5.2;
    const angle = random() * Math.PI * 2;
    const style = pick([
      '#4c412f', '#64503a', '#59452f', '#776044',
      '#28291e', '#413b2b', '#6c553e', '#4c5035',
    ]);
    wrapDraw(x, y, 7, () => {
      ctx.rotate(angle);
      ctx.strokeStyle = style;
      ctx.lineWidth = .35 + random() * .8;
      ctx.beginPath();
      ctx.moveTo(-length * .5, 0);
      ctx.lineTo(length * .5, .2 + random() * .8);
      ctx.stroke();
    });
  }

  // Fallen leaves as irregular, bent almond silhouettes with tiny veins.
  const leafColors = [
    '#776044', '#8b714d', '#6f523b', '#a08356',
    '#544a37', '#59402e', '#4e4a30', '#7f6446',
    '#4a4836', '#967b51', '#654b35', '#3e3829',
  ];
  for (let i = 0; i < 1050; i++) {
    const x = random() * size, y = random() * size;
    const length = 4.5 + random() * 12.5;
    const width = length * (.25 + random() * .23);
    const skew = (random() - .5) * width;
    const angle = random() * Math.PI * 2;
    const fill = pick(leafColors);
    wrapDraw(x, y, 22, () => {
      ctx.rotate(angle);
      // Slight dark impression under the leaf.
      ctx.fillStyle = 'rgba(12,13,8,.22)';
      ctx.beginPath();
      ctx.ellipse(.9, 1.2, length * .47, width * .75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(-length * .5, 0);
      ctx.quadraticCurveTo(-length * .13, -width * 1.1, length * .5, skew);
      ctx.quadraticCurveTo(length * .09, width * 1.1, -length * .5, 0);
      ctx.fill();
      ctx.strokeStyle = 'rgba(186,155,101,.24)';
      ctx.lineWidth = .55;
      ctx.beginPath();
      ctx.moveTo(-length * .47, 0);
      ctx.quadraticCurveTo(0, 0, length * .43, skew);
      ctx.stroke();
    });
  }

  // Thin fallen twigs with darker undersides and short branching offshoots.
  for (let i = 0; i < 245; i++) {
    const x = random() * size, y = random() * size;
    const len = 13 + random() * 65;
    const angle = random() * Math.PI * 2;
    const bent = (random() - .5) * len * .26;
    const diameter = .7 + random() * 2.0;
    wrapDraw(x, y, 85, () => {
      ctx.rotate(angle);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(9,10,6,.38)';
      ctx.lineWidth = diameter + 1.15;
      ctx.beginPath();
      ctx.moveTo(-len * .5 + 1, 1.5);
      ctx.quadraticCurveTo(0, bent + 1.5, len * .5 + 1, 1.5);
      ctx.stroke();
      ctx.strokeStyle = pick(['#775b3f', '#5e4934', '#8b6a44', '#4e4333', '#695038']);
      ctx.lineWidth = diameter;
      ctx.beginPath();
      ctx.moveTo(-len * .5, 0);
      ctx.quadraticCurveTo(0, bent, len * .5, 0);
      ctx.stroke();
      if (random() < .47) {
        const at = (random() - .5) * len * .55;
        ctx.strokeStyle = '#4c3b2c';
        ctx.lineWidth = Math.max(.5, diameter * .52);
        ctx.beginPath();
        ctx.moveTo(at, bent * .65);
        ctx.lineTo(at + (random() - .5) * 15, bent * .65 - 4 - random() * 9);
        ctx.stroke();
      }
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}
