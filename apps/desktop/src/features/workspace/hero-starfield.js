import {createOrbitMotion} from './orbit-motion.js';

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

function drawFlare(ctx, x, y, tangent, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tangent);
  ctx.scale(size, size);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 10);
  glow.addColorStop(0, 'rgba(255,255,255,.86)');
  glow.addColorStop(.19, 'rgba(244,246,250,.34)');
  glow.addColorStop(1, 'rgba(244,246,250,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-10, -10, 20, 20);
  // The long tail follows the orbit; the shorter cross-spike catches its tip.
  ctx.fillStyle = 'rgba(255,255,255,.96)';
  ctx.beginPath();
  ctx.moveTo(-13, 0);
  ctx.quadraticCurveTo(-1.2, -.4, 0, -4);
  ctx.quadraticCurveTo(.4, -.7, 5, 0);
  ctx.quadraticCurveTo(.5, .6, 0, 4);
  ctx.quadraticCurveTo(-.7, .6, -13, 0);
  ctx.fill();
  ctx.restore();
}

function paintOrbits(ctx, width, height) {
  const extent = Math.min(width * .47, height * .82);
  ctx.save();
  ctx.translate(width * .5, height * .43);
  function arc(rx, ry, tilt, from, to, opacity, weight, flare = 0) {
    rx *= extent;
    ry *= extent;
    ctx.save();
    ctx.rotate(tilt);
    const x = rx * Math.cos(to), y = ry * Math.sin(to);
    const shine = ctx.createLinearGradient(rx * Math.cos(from), ry * Math.sin(from), x, y);
    shine.addColorStop(0, 'rgba(224,228,234,0)');
    shine.addColorStop(.32, `rgba(224,228,234,${opacity * .23})`);
    shine.addColorStop(.83, `rgba(241,243,247,${opacity * .77})`);
    shine.addColorStop(1, `rgba(255,255,255,${flare ? opacity : 0})`);
    ctx.strokeStyle = shine;
    ctx.lineWidth = weight;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, from, to);
    ctx.stroke();
    if (flare) drawFlare(ctx, x, y, Math.atan2(ry * Math.cos(to), -rx * Math.sin(to)), flare);
    ctx.restore();
  }
  // A tight double sweep crests above the disc. Counter-orbits only show segments.
  arc(1.02, .30, -.28, 2.74, 5.86, .88, .95, 1.12);
  arc(1.04, .325, -.28, 2.94, 5.95, .58, .58);
  arc(.91, .32, .38, 1.82, 3.48, .68, .77, .72);
  arc(.88, .38, .41, 5.00, 6.47, .49, .67, .45);
  arc(.76, .46, -.78, 2.44, 4.52, .40, .56);
  ctx.restore();
}

// Use identical geometry in the static field and its masked highlight layer.
function paintGrazingBeams(ctx, width, height, intensity) {
  const extent = Math.min(width * .47, height * .82);
  ctx.save();
  ctx.translate(width * .5, height * .43);
  ctx.scale(extent, extent);
  const beam = ctx.createLinearGradient(-1.16, 0, 1.16, 0);
  beam.addColorStop(0, 'transparent');
  beam.addColorStop(.17, `rgba(255,255,255,${.73 * intensity})`);
  beam.addColorStop(.48, `rgba(255,255,255,${.12 * intensity})`);
  beam.addColorStop(.83, `rgba(255,255,255,${.84 * intensity})`);
  beam.addColorStop(1, 'transparent');
  ctx.strokeStyle = beam;
  for (const spread of [0, .045, .11]) {
    ctx.lineWidth = (spread === 0 ? 1.05 : .6) / extent;
    ctx.globalAlpha = spread === 0 ? 1 : .65;
    ctx.beginPath();
    ctx.moveTo(-1.16, -.13 + spread);
    ctx.bezierCurveTo(-.74, -.60, -.28, -.72 - spread, 1.16, -.53 - spread);
    ctx.moveTo(-1.16, .40 + spread);
    ctx.bezierCurveTo(-.70, .74 + spread, .58, .68 + spread, 1.16, -.11);
    ctx.stroke();
  }
  ctx.restore();
}

function prepareCanvas(canvas, width, height) {
  const ctx = canvas.getContext('2d');
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(width * ratio);canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

function paintScene(canvas, width, height) {
  const ctx = prepareCanvas(canvas, width, height);
  // Low-resolution fractal light is smoothly enlarged; sharp stars stay native resolution.
  const cloud = document.createElement('canvas');
  // The cloud is soft by design; sharp stars are drawn separately at display
  // resolution. A smaller source avoids blocking the renderer during resize.
  cloud.width = Math.min(192, Math.ceil(width / 5));cloud.height = Math.min(56, Math.ceil(height / 5));
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
      const alpha = Math.min(.45, (wisps * .53 * density + fog * .12 * swirl) * illumination);
      const offset = (y * cloud.width + x) * 4;
      pixels.data[offset] = 219;pixels.data[offset + 1] = 223;pixels.data[offset + 2] = 230;
      pixels.data[offset + 3] = Math.round(alpha * 255);
    }
  }
  cloudCtx.putImageData(pixels, 0, 0);ctx.drawImage(cloud, 0, 0, width, height);

  const stars = Math.min(700, Math.round(width * height / 420));
  for (let i = 0; i < stars; i++) {
    const x = hash(i, 4) * width, y = hash(i, 9) * height;
    const size = .18 + Math.pow(hash(i, 14), 4) * 1.05;
    const nearBand = Math.exp(-Math.pow((y / height - streamY(x / width)) / .12, 2));
    const alpha = (.07 + hash(i, 32) * .3) * (.45 + nearBand * .7);
    ctx.fillStyle = `rgba(242,245,250,${alpha})`;ctx.beginPath();ctx.arc(x, y, size, 0, Math.PI * 2);ctx.fill();
  }

  paintOrbits(ctx, width, height);
  paintGrazingBeams(ctx, width, height, 1);
}

export function mountHeroStarfield(hero) {
  const canvas = document.createElement('canvas');canvas.className = 'cc-hero-field';
  canvas.setAttribute('aria-hidden', 'true');hero.prepend(canvas);
  let motion, inViewport = false, disposed = false, previous = '', pending = 0, timer = 0;
  const paused = () => disposed || document.hidden || !inViewport;
  const paint = () => {
    pending = 0;
    if (paused()) return;
    const {width, height} = hero.getBoundingClientRect(), signature = `${width}:${height}:${window.devicePixelRatio}`;
    if (width < 1 || height < 1 || signature === previous) return;
    paintScene(canvas, width, height);
    if (!motion) {
      motion = createOrbitMotion();
      canvas.after(motion);
    }
    paintGrazingBeams(prepareCanvas(motion.querySelector('.cc-orbit-sweep'), width, height), width, height, 1.18);
    previous = signature;
  };
  const request = () => {
    timer = 0;
    if (!pending && !paused()) pending = requestAnimationFrame(paint);
  };
  const cancelWork = () => {
    clearTimeout(timer);
    if (pending) cancelAnimationFrame(pending);
    timer = pending = 0;
  };
  // During an interactive resize CSS scales the existing canvas. Repaint once
  // after the burst instead of recomputing the cloud for every intermediate size.
  const resized = () => {
    if (paused()) return;
    cancelWork();
    timer = setTimeout(request, 100);
  };
  const visibility = () => {
    cancelWork();
    hero.dataset.scenePaused = String(paused());
    if (paused()) return;
    if (!previous) timer = setTimeout(request, 60);
    else request();
  };
  const viewport = new IntersectionObserver(entries => {
    if (disposed || !entries.length) return;
    const entry = entries[entries.length - 1];
    const visible = entry.isIntersecting && entry.intersectionRatio >= .001;
    if (inViewport === visible) return;
    inViewport = visible;
    visibility();
  }, {threshold:.001});
  viewport.observe(hero);
  const observer = new ResizeObserver(resized);observer.observe(hero);
  document.addEventListener('visibilitychange', visibility);visibility();
  const dispose = () => {
    disposed = true;
    hero.dataset.scenePaused = 'true';
    observer.disconnect();
    viewport.disconnect();
    cancelWork();
    motion?.remove();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('unload', dispose);
  };
  window.addEventListener('unload', dispose, {once:true});
  return {dispose};
}
