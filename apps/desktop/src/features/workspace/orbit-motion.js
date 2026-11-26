const SIZE = 256;
const CENTER = SIZE / 2;
const TURN = Math.PI * 2;

// Angles and trail lengths are in radians on a circular texture. CSS projects
// each rotating texture onto a differently inclined orbital plane.
const PLANES = [
  {name: 'equatorial', direction: 1, heads: [-.34, 2.72], trail: 1.18},
  {name: 'inclined', direction: -1, heads: [.77, 4.04], trail: .83},
  {name: 'outer', direction: 1, heads: [1.65, 5.16], trail: .65},
];

function strokeTail(ctx, radius, head, length, weight, opacity) {
  const segments = 24;
  ctx.lineCap = 'round';
  for (let i = 0; i < segments; i++) {
    const end = (i + 1) / segments;
    ctx.globalAlpha = opacity * end * end;
    ctx.lineWidth = weight * (.28 + .72 * end);
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, radius,
      head - length * (1 - i / segments), head - length * (1 - end), length < 0);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function paintPlane(canvas, {heads, direction, trail}) {
  canvas.width = canvas.height = SIZE * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  ctx.strokeStyle = ctx.fillStyle = '#fff';
  heads.forEach((head, index) => {
    const radius = index ? 106 : 118;
    const length = trail * direction * (index ? .65 : 1);
    strokeTail(ctx, radius, head, length * 1.65, 3.2, .13);
    strokeTail(ctx, radius, head, length, 1.65, .94);
    strokeTail(ctx, radius - 3, head - length * .21, length * .83, .85, .53);

    const x = CENTER + radius * Math.cos(head), y = CENTER + radius * Math.sin(head);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 8);
    glow.addColorStop(0, 'white');
    glow.addColorStop(.26, 'rgba(255,255,255,.55)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 8, y - 8, 16, 16);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, index ? 1.6 : 2.15, 0, TURN);
    ctx.fill();

    // A broken wake on either side of the thin central filament.
    for (let i = 1; i <= 13; i++) {
      const angle = head - length * (.12 + i * .079);
      const offset = Math.sin(i * 2.31 + index) * (1.5 + i * .33);
      ctx.globalAlpha = .63 - i * .034;
      ctx.beginPath();
      ctx.arc(CENTER + (radius + offset) * Math.cos(angle),
        CENTER + (radius + offset) * Math.sin(angle), i % 4 === 0 ? 1 : .63, 0, TURN);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

export function createOrbitMotion() {
  const field = document.createElement('div');
  field.className = 'cc-orbit-motion';
  field.setAttribute('aria-hidden', 'true');
  for (const plane of PLANES) {
    const projection = document.createElement('span');
    projection.className = 'cc-orbit-plane';
    projection.dataset.plane = plane.name;
    const texture = document.createElement('canvas');
    texture.className = 'cc-orbit-drift';
    paintPlane(texture, plane);
    projection.append(texture);
    field.append(projection);
  }
  const sweep = document.createElement('canvas');
  sweep.className = 'cc-orbit-sweep';
  field.append(sweep);
  return field;
}
