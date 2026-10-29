// Lightweight 2D minimap: local player stays centered, north points up.
export function createMinimap(ctx) {
  const canvas = ctx.$('minimap');
  const g = canvas.getContext('2d');
  const size = canvas.width;
  const center = size / 2;
  const radius = center - 12;
  const range = 55; // world meters to the edge of the circular map
  const metersToPixels = radius / range;
  const position = (x, z) => [center + (x - ctx.px) * metersToPixels,
    center + (z - ctx.pz) * metersToPixels];
  const circle = (x, y, r, fill) => {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
  };
  function draw() {
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath(); g.arc(center, center, radius, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#0d261e'; g.fillRect(0, 0, size, size);
    g.strokeStyle = '#ffffff16'; g.lineWidth = 1;
    for (let d = -range; d <= range; d += 10) {
      const sx = center + (Math.ceil(ctx.px / 10) * 10 + d - ctx.px) * metersToPixels;
      const sy = center + (Math.ceil(ctx.pz / 10) * 10 + d - ctx.pz) * metersToPixels;
      g.beginPath();g.moveTo(sx,0);g.lineTo(sx,size);g.stroke();
      g.beginPath();g.moveTo(0,sy);g.lineTo(size,sy);g.stroke();
    }
    // Nearby trees and constructed logs give useful landmarks.
    for (const tree of ctx.trees.values()) {
      const [x,y] = position(tree.position.x, tree.position.z);
      if ((x-center)**2+(y-center)**2 < radius**2) circle(x,y,1.7,'#4c9862');
    }
    for (const log of ctx.placed) {
      const [x,y] = position(log.x,log.z);
      if ((x-center)**2+(y-center)**2 < radius**2) circle(x,y,2.4,'#d3a16d');
    }
    for (const [id,avatar] of ctx.avatars) {
      const [x,y] = position(avatar.group.position.x,avatar.group.position.z);
      // Edge-clamp distant players, so their direction remains visible.
      const dx=x-center,dy=y-center,d=Math.hypot(dx,dy);
      const scale=d > radius-7 ? (radius-7)/d : 1;
      const px=center+dx*scale,py=center+dy*scale;
      circle(px,py,5.5,'#132a37');circle(px,py,3.8,'#59bcff');
      if (d > radius-7) {
        g.strokeStyle='#59bcff';g.lineWidth=1.5;
        g.beginPath();g.arc(px,py,6.7,0,Math.PI*2);g.stroke();
      }
    }
    // Own position and view direction (forward is -sin(yaw), -cos(yaw)).
    const angle=ctx.yaw;
    const dx=-Math.sin(angle),dy=-Math.cos(angle);
    const sx=Math.cos(angle),sy=-Math.sin(angle);
    g.beginPath();
    g.moveTo(center+dx*10,center+dy*10);
    g.lineTo(center-dx*6+sx*5,center-dy*6+sy*5);
    g.lineTo(center-dx*6-sx*5,center-dy*6-sy*5);
    g.closePath();g.fillStyle='#ffe18d';g.fill();
    g.lineWidth=1.5;g.strokeStyle='#263b28';g.stroke();
    g.restore();
    g.strokeStyle='#90b8a5aa';g.lineWidth=2;
    g.beginPath();g.arc(center,center,radius,0,Math.PI*2);g.stroke();
    g.font='bold 12px system-ui';g.textAlign='center';g.fillStyle='#e6ffe9';
    g.fillText('N',center,13);
  }
  draw();
  const timer=setInterval(draw,150);
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
