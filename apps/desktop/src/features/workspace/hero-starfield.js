// A procedural panoramic scene. No network assets or additional animation loop.
const smooth = value => value * value * (3 - 2 * value);
function hash(x, y) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y) {
  const left = Math.floor(x), top = Math.floor(y), fx = smooth(x - left), fy = smooth(y - top);
  const a = hash(left, top), b = hash(left + 1, top), c = hash(left, top + 1), d = hash(left + 1, top + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
function turbulence(x, y) {
  return noise(x, y) * .5 + noise(x * 2.1 + 19, y * 2.1) * .27
    + noise(x * 4.3, y * 4.3 + 13) * .15 + noise(x * 8.7 + 5, y * 8.7) * .08;
}
const streamY = x => .82 - x * .17 + Math.sin(x * 8 + 1) * .055;

function paintScene(canvas, width, height) {
  const ctx = canvas.getContext('2d');
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(width * ratio);canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // Low-resolution fractal light is smoothly enlarged; sharp stars stay native resolution.
  const cloud = document.createElement('canvas');
  cloud.width = Math.min(780, Math.ceil(width / 1.6));cloud.height = Math.min(200, Math.ceil(height / 1.6));
  const cloudCtx = cloud.getContext('2d'), pixels = cloudCtx.createImageData(cloud.width, cloud.height);
  for (let y = 0; y < cloud.height; y++) {
    for (let x = 0; x < cloud.width; x++) {
      const u = x / cloud.width, v = y / cloud.height;
      const swirl = turbulence(u * 8, v * 5);
      const ridge = streamY(u) + (swirl - .5) * .16;
      const distance = Math.abs(v - ridge);
      const wisps = Math.exp(-Math.pow(distance / .065, 2));
      const fog = Math.exp(-Math.pow(distance / .23, 2));
      const detail = turbulence(u * 36 + 40, v * 18 + swirl * 5);
      const density = Math.pow(detail, 1.7);
      const illumination = .6 + Math.exp(-Math.pow((u - .73) / .25, 2)) * .7;
      const alpha = Math.min(.68, (wisps * .92 * density + fog * .16 * swirl) * illumination);
      const offset = (y * cloud.width + x) * 4;
      pixels.data[offset] = 219;pixels.data[offset + 1] = 223;pixels.data[offset + 2] = 230;
      pixels.data[offset + 3] = Math.round(alpha * 255);
    }
  }
  cloudCtx.putImageData(pixels, 0, 0);ctx.drawImage(cloud, 0, 0, width, height);

  const stars = Math.min(2400, Math.round(width * height / 160));
  for (let i = 0; i < stars; i++) {
    const x = hash(i, 4) * width, y = hash(i, 9) * height;
    const size = .18 + Math.pow(hash(i, 14), 4) * 1.05;
    const nearBand = Math.exp(-Math.pow((y / height - streamY(x / width)) / .12, 2));
    const alpha = (.07 + hash(i, 32) * .3) * (.45 + nearBand * .7);
    ctx.fillStyle = `rgba(242,245,250,${alpha})`;ctx.beginPath();ctx.arc(x, y, size, 0, Math.PI * 2);ctx.fill();
  }

  // Delicate energy filaments travel across the complete banner, behind both title and orb.
  const trail = ctx.createLinearGradient(0, 0, width, 0);
  trail.addColorStop(0, 'rgba(238,242,250,0)');trail.addColorStop(.18, 'rgba(238,242,250,.08)');
  trail.addColorStop(.72, 'rgba(238,242,250,.24)');trail.addColorStop(1, 'rgba(238,242,250,0)');
  ctx.strokeStyle = trail;
  for (let line = 0; line < 18; line++) {
    ctx.lineWidth = line % 4 === 0 ? .8 : .35;
    const offset = (line - 9) * 1.6;
    ctx.beginPath();ctx.moveTo(-20, height * .86 + offset);
    ctx.bezierCurveTo(width * .32, height * 1.14 - offset, width * .61, height * .45 + offset,
      width + 20, height * .72 + offset);ctx.stroke();
  }

  for (let i = 0; i < 7; i++) {
    const x = width * (.055 + hash(i, 118) * .89), y = height * (.08 + hash(i, 202) * .75);
    const size = i % 3 === 0 ? 1.25 : .7;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 9);
    glow.addColorStop(0, 'rgba(255,255,255,.65)');glow.addColorStop(.15, 'rgba(255,255,255,.2)');glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;ctx.fillRect(x - size * 9, y - size * 9, size * 18, size * 18);
    ctx.fillStyle = 'rgba(255,255,255,.85)';ctx.beginPath();ctx.arc(x, y, size, 0, Math.PI * 2);ctx.fill();
  }
}

export function mountHeroStarfield(hero) {
  const canvas = document.createElement('canvas');canvas.className = 'cc-hero-field';
  canvas.setAttribute('aria-hidden', 'true');hero.prepend(canvas);
  let pending = 0, disposed = false, previous = '';
  const paint = () => {
    pending = 0;if (disposed || document.hidden) return;
    const {width, height} = hero.getBoundingClientRect(), signature = `${width}:${height}:${window.devicePixelRatio}`;
    if (width < 1 || height < 1 || signature === previous) return;
    previous = signature;paintScene(canvas, width, height);
  };
  const request = () => {if (!pending && !disposed && !document.hidden) pending = requestAnimationFrame(paint);};
  const visibility = () => {hero.dataset.scenePaused = String(document.hidden);if (document.hidden && pending) {cancelAnimationFrame(pending);pending = 0;}else request();};
  const observer = new ResizeObserver(request);observer.observe(hero);
  document.addEventListener('visibilitychange', visibility);visibility();
  const dispose = () => {disposed = true;observer.disconnect();if (pending) cancelAnimationFrame(pending);document.removeEventListener('visibilitychange', visibility);window.removeEventListener('unload', dispose);};
  window.addEventListener('unload', dispose, {once:true});
  return {dispose};
}
