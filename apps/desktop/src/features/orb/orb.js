// ORB-02: renderer ported from the original approved reference; 170 shell points.
const ORB_STATES = {
  idle: { zh: "待机", shape: "sphere" },
  listening: { zh: "倾听", shape: "sphere" },
  thinking: { zh: "思考", shape: "sphere" },
  executing: { zh: "执行", shape: "sphere" },
  waiting: { zh: "等待", shape: "tight" },
  error: { zh: "失败", shape: "scatter" },
};

/* bright = 状态亮度档位（由暗到亮）；shape 决定点集怎么摆 */
const STATE_PARAMS = {
  idle: { spin: 0.06, breath: 0.03, scale: 1.0, bright: 0.8, tilt: 0.34 },
  listening: { spin: 0.03, breath: 0.05, scale: 0.95, bright: 1.0, tilt: 0.12 },
  thinking: { spin: 0.55, breath: 0.02, scale: 1.14, bright: 1.0, tilt: 0.24 },
  executing: { spin: 0.06, breath: 0.03, scale: 1.0, bright: 1.0, tilt: 0.34 },
  waiting: { spin: 0.008, breath: 0.008, scale: 0.72, bright: 0.52, tilt: 0.3 },
  error: { spin: 0.02, breath: 0.006, scale: 1.22, bright: 0.42, tilt: 0.24 },
};

/* 形态目录：选择器与比选页共用 */
const ORB_VARIANTS = [
  { id: "particle", name: "粒子球壳", note: "黑核 + 亮白粒子壳，六状态换剪影" },
  { id: "matrix", name: "规则点阵", note: "LED 点阵分布，读数感强、边缘干净" },
  { id: "orbit", name: "极简轨道", note: "黑核 + 少数绕行亮点，常驻最不干扰" },
  { id: "wire", name: "线框球", note: "经纬线描边，工具感 / 工程感" },
  { id: "glass", name: "玻璃球", note: "透明折射，与玻璃面板同一套材质语言" },
  { id: "aura", name: "亮白光团", note: "无黑核，纯柔光呼吸，最不像「黑洞」" },
  { id: "ink", name: "墨滴", note: "黑核边缘噪声扰动，生物感" },
  { id: "pulse", name: "脉冲环", note: "黑核 + 向外扩散同心环，状态=环频" },
];

function fibonacciSphere(n) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r, u: i / n, seed: Math.random() });
  }
  return pts;
}

/* 规则纬度环点阵 */
function latticeRings() {
  const out = [];
  const N = 9;
  for (let i = 1; i < N; i++) {
    const phi = (i / N) * Math.PI;
    const y = Math.cos(phi);
    const r = Math.sin(phi);
    const count = Math.max(4, Math.round(2 * Math.PI * r * 7));
    for (let j = 0; j < count; j++) {
      const a = (j / count) * Math.PI * 2 + i * 0.35;
      out.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, ring: i, u: i / N, seed: j / count });
    }
  }
  out.push({ x: 0, y: 1, z: 0, ring: 0, u: 0, seed: 0 });
  out.push({ x: 0, y: -1, z: 0, ring: 0, u: 1, seed: 0.5 });
  return out;
}

const SHAPES = {
  sphere: (p) => [p.x, p.y, p.z],
  dome: (p) => {
    const r = Math.hypot(p.x, p.y);
    const k = r > 1 ? 1 / r : 1;
    const x = p.x * k, y = p.y * k;
    return [x * 1.02, y * 1.02, 0.34 + Math.sqrt(Math.max(0, 1 - x * x - y * y)) * 0.66];
  },
  ring: (p) => [p.x * 1.3, p.y * 0.06, p.z * 1.3],
  gyro: (p) => [p.x * 1.22, p.y * 0.06, p.z * 1.22],
  tight: (p) => [p.x * 0.92, p.y * 0.92, p.z * 0.92],
  scatter: (p) => {
    const k = 1.1 + p.seed * 0.5;
    return [p.x * k, p.y * k * 0.72 + p.seed * 0.42, p.z * k];
  },
};

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - Math.pow(1 - t, 3);
const EARTH_TILT = 23.44 * Math.PI / 180;
const COLLAPSE_HALO_PTS = fibonacciSphere(84);
const CORE_PAD = 2;
const LUMINOUS_STAR_PX = 64;
/* 一个周期：靠近、变远、再靠近、再靠近。亮度和半径一起走。 */
const BREATH_KEYS = [
  { t: 0, r: 1, b: 0.7 },
  { t: 0.18, r: 0.7, b: 1 },
  { t: 0.42, r: 1.38, b: 0.32 },
  { t: 0.66, r: 0.8, b: 0.88 },
  { t: 0.86, r: 0.54, b: 1 },
  { t: 1, r: 1, b: 0.7 },
];

function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export function breathSample(phase) {
  const t = ((phase % 1) + 1) % 1;
  let index = 1;
  while (index < BREATH_KEYS.length - 1 && BREATH_KEYS[index].t < t) index++;
  const from = BREATH_KEYS[index - 1];
  const to = BREATH_KEYS[index];
  const span = to.t - from.t || 1;
  const mix = smoothstep((t - from.t) / span);
  return { radius: lerp(from.r, to.r, mix), bright: lerp(from.b, to.b, mix) };
}

export function orbMotionKind({ state = "idle", breathActive = false } = {}) {
  if (state === "error") return "collapse";
  if (breathActive) return "breath";
  if (state === "thinking" || state === "executing") return "breath";
  if (state === "listening") return "voice";
  return "earth";
}

export class Orb {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.variant = options.variant ?? "matrix";
    this.layout = options.layout ?? "shell"; // particle 子选项：shell | bands | lattice
    this.count = options.count ?? 170;
    // Workspace-only presentation; other orb surfaces keep their original appearance.
    this.luminous = options.luminous === true;
    this.dust = this.luminous ? Array.from({length: 180}, (_, i) => {
      const fraction = n => {const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;return value - Math.floor(value);};
      const radius = 1.14 + fraction(i + 201) * 1.3;
      const alpha = .12 + fraction(i + 601) * .48;
      const edge = Math.max(0, 1 - (radius - 1.14) / 1.8);
      return {angle:fraction(i + 1) * Math.PI * 2, radius,
        size:.22 + fraction(i + 401) * .45, alpha, edge, baseAlpha: Math.min(.7, alpha * 1.45) * edge, phase:fraction(i + 801) * Math.PI * 2};
    }) : [];
    this.breathRate = options.breathRate ?? 0.78;
    this.breathMin = 0.35;
    this.breathMax = 0.92;
    this.cohesion = null;
    this.state = "idle";
    this.from = { ...STATE_PARAMS.idle };
    this.to = { ...STATE_PARAMS.idle };
    this.mix = 1;
    this.shapeFrom = "sphere";
    this.shapeTo = "sphere";
    this.level = 0;
    this.breathOrigin = 0;
    this.breathUntil = null;
    this.progress = null;
    this.angle = 0;
    this.angle2 = 0;
    this.time = 0;
    this.calm = false;
    this.running = false;
    // Ambient Canvas animation does not need to repaint at a 120/144/240Hz display rate.
    this._frameInterval = 1000 / 30;
    this._maxDpr = 2;
    this._dpr = 1;
    this._tokenCache = null;
    this._coreCache = null;
    this._luminousCoreCache = null;
    this._starSprite = null;
    this._dotPool = [];
    this._particlePool = [];
    this._collapsePool = [];
    this._luminousPts = null;
    this._rebuild();
    this._resize();
    this._observer = new ResizeObserver(() => {
      this._resize();
      if (!this.running) this._draw();
    });
    this._observer.observe(canvas.parentElement ?? canvas);
    // Theme and calm live in CSS custom properties; one event replaces per-frame getComputedStyle.
    this._onPreferences = () => {
      this._dropRenderCaches();
      if (!this.running) this._draw();
    };
    window.addEventListener?.("preferences-changed", this._onPreferences);
    this.start();
  }

  _buildLuminousPts(points) {
    return points.map(pt => {
      let x = pt.x + Math.sin(pt.seed * 71) * 0.055;
      let y = pt.y + Math.sin(pt.seed * 113) * 0.055;
      let z = pt.z + Math.cos(pt.seed * 97) * 0.055;
      const length = Math.hypot(x, y, z) || 1;
      return { x: x / length, y: y / length, z: z / length, u: pt.u, seed: pt.seed };
    });
  }

  _rebuild() {
    this.points = this.layout === "lattice" ? latticeRings() : fibonacciSphere(this.count);
    this._luminousPts = this.luminous ? this._buildLuminousPts(this.points) : null;
    this._dotPool = [];
    this._particlePool = [];
  }

  setVariant(v) {
    if (!ORB_VARIANTS.some((x) => x.id === v) || v === this.variant) return;
    this.variant = v;
    if (!this.running && !this.calm) this.start();
    this._draw();
  }

  setLayout(l) {
    if (!["shell", "bands", "lattice"].includes(l) || l === this.layout) return;
    this.layout = l;
    this._rebuild();
    this._draw();
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, this._maxDpr ?? 2);
    this._dpr = dpr;
    this.w = Math.max(rect.width, 24);
    this.h = Math.max(rect.height, 24);
    const width = Math.round(this.w * dpr), height = Math.round(this.h * dpr);
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setState(next) {
    if (!STATE_PARAMS[next] || next === this.state) return;
    this.from = this._params();
    this.shapeFrom = this.mix >= 0.5 ? this.shapeTo : this.shapeFrom;
    this.state = next;
    this.to = { ...STATE_PARAMS[next] };
    this.shapeTo = ORB_STATES[next].shape;
    this.mix = this.calm ? 1 : 0;
    if (this.calm) this._draw();
    if (!this.running && !this.calm) this.start();
  }

  setLevel(v) { this.level = Math.max(0, Math.min(1, v)); }
  setResourceBudget({fps=30,maxDpr=2}={}) {
    const nextFps=Number.isFinite(fps)?Math.max(8,Math.min(30,fps)):30;
    const nextDpr=Number.isFinite(maxDpr)?Math.max(1,Math.min(2,maxDpr)):2;
    this._frameInterval=1000/nextFps;
    if(this._maxDpr!==nextDpr){this._maxDpr=nextDpr;this._resize();if(!this.running)this._draw();}
  }
  /* 大工作区点击与思考、执行共用同一段呼吸。 */
  playBreath(seconds = 3.2) {
    if (this.calm) { this.breathUntil = null; return; }
    const span = Math.max(0.6, Number(seconds) || 3.2);
    this.breathOrigin = this.time;
    this.breathUntil = this.time + span;
    if (!this.running) this.start();
  }
  _kind() {
    return orbMotionKind({
      state: this.state,
      breathActive: this.breathUntil != null && this.time < this.breathUntil,
    });
  }
  setProgress(p) { this.progress = p; }
  /* 呼吸态：cohesion=1 紧致、0 分散；null 表示跟随呼吸周期自动摆动 */
  setCohesion(v) {
    this.cohesion = v == null ? null : Math.max(0, Math.min(1, v));
    if (this.calm) this._draw();
    else if (!this.running) this.start();
  }
  setBreathing(opts = {}) {
    if (opts.min != null) this.breathMin = Math.max(0, Math.min(1, opts.min));
    if (opts.max != null) this.breathMax = Math.max(0, Math.min(1, opts.max));
    if (opts.rate != null) this.breathRate = opts.rate;
  }
  _cohesion() {
    if (this.cohesion != null) return this.cohesion;
    if (this.calm) return (this.breathMin + this.breathMax) / 2;
    return lerp(this.breathMin, this.breathMax, 0.5 + 0.5 * Math.sin(this.time * this.breathRate * 0.9));
  }
  /* 音量动效：声音越大壳层越扩散；倾听态幅度最大，其余状态仅作低幅预览 */
  _spread(pt) {
    const c = this._cohesion();
    const seed = pt?.seed ?? 0.5;
    const voice = this.level * (this.state === "listening" ? 0.32 : 0.14);
    // 音量扩散按每颗粒子自有半径分量走，形成 3D 体积云而非整壳缩放
    const personal = 1 + voice * (seed - 0.5) * 0.9;
    const jitter = 1 + (1 - c) * 0.08 * Math.sin(this.time * 1.3 + seed * 34);
    // 执行态保留待机球体，但壳层持续轻微扩散，不再切成陀螺盘。
    const executing = this.state === "executing"
      ? 1.08 + (seed - 0.5) * 0.08 + Math.sin(this.time * 1.05 + seed * 19) * 0.018
      : 1;
    return lerp(1.16, 0.9, c) * (1 + voice * 0.55) * personal * jitter * executing;
  }
  /* 执行态：在同一扩散球体上由极亮到极暗持续往复 */
  _flash() {
    if (this.state !== "executing") return 1;
    const wave = 0.5 + 0.5 * Math.sin(this.time * 2.8);
    return 0.08 + 0.92 * Math.pow(wave, 1.12);
  }
  /* 错误态：粒子向黑核收束并淡出，终态只剩黑核 */
  _errorFade() {
    return this.state === "error" ? 1 - ease(this.mix) : 1;
  }
  setCalm(calm) {
    this.calm = calm;
    if (calm) { this.breathUntil = null; this.mix = 1; this.stop(); this._draw(); }
    else this.start();
  }

  _params() {
    const m = ease(this.mix);
    return {
      spin: lerp(this.from.spin, this.to.spin, m),
      breath: lerp(this.from.breath, this.to.breath, m),
      scale: lerp(this.from.scale, this.to.scale, m),
      bright: lerp(this.from.bright, this.to.bright, m),
      tilt: lerp(this.from.tilt, this.to.tilt, m),
    };
  }

  start() {
    if (this.running || this.calm) return;
    this.running = true;
    this._last = null;
    this._lastPaint = null;
    const loop = (t) => {
      if (!this.running) return;
      const elapsed = t - (this._lastPaint ?? t - this._frameInterval);
      if (elapsed + 0.1 < this._frameInterval) {
        this._raf = requestAnimationFrame(loop);
        return;
      }
      this._lastPaint = t;
      const dt = Math.min((t - (this._last ?? t)) / 1000, 0.05);
      this._last = t;
      this.time += dt;
      this.mix = Math.min(1, this.mix + dt / (this.state === "error" ? 0.9 : 0.36));
      const p = this._params();
      const kind = this._kind();
      const rate = kind === "earth" ? (this.state === "waiting" ? 0.065 : 0.15)
        : kind === "voice" ? 0.08 + this.level * 0.72
        : kind === "breath" ? 0.4
        : 0.2 + (1 - ease(this.mix)) * 1.15;
      this.angle += dt * rate * Math.PI;
      this.angle2 += dt * rate * Math.PI * 1.6;
      this._draw();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    this.breathUntil = null;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _tokens() {
    if (this._tokenCache) return this._tokenCache;
    const css = getComputedStyle(this.canvas);
    const v = (n, fb) => (css.getPropertyValue(n).trim() || fb);
    this._tokenCache = {
      particle: v("--orb-particle", "#ffffff"),
      core1: v("--orb-core-1", "#05070a"),
      core2: v("--orb-core-2", "#10151c"),
      accent: v("--accent", "#52c7bd"),
      danger: v("--danger", "#ef6a72"),
    };
    return this._tokenCache;
  }

  _releaseCacheCanvas(cache) {
    if (cache?.canvas) { cache.canvas.width = 0; cache.canvas.height = 0; }
  }

  _dropRenderCaches() {
    this._tokenCache = null;
    this._releaseCacheCanvas(this._coreCache);
    this._coreCache = null;
    this._releaseCacheCanvas(this._luminousCoreCache);
    this._luminousCoreCache = null;
    this._releaseCacheCanvas(this._starSprite);
    this._starSprite = null;
  }

  /** Drop cached design tokens after a theme, calm or palette change. */
  refreshTokens() {
    this._dropRenderCaches();
    if (!this.running) this._draw();
  }

  _makeOffscreen(w, h) {
    if (typeof document === "undefined" || typeof document.createElement !== "function") return null;
    const canvas = document.createElement("canvas");
    if (!canvas) return null;
    canvas.width = Math.max(1, Math.ceil(w));
    canvas.height = Math.max(1, Math.ceil(h));
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return null;
    return { canvas, ctx };
  }

  _effectiveDpr() {
    return this._dpr ?? Math.min((typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1, this._maxDpr ?? 2);
  }

  _geom(p) {
    const breath = this.calm ? 1 : 1 + Math.sin(this.time * this.breathRate) * p.breath + this.level * 0.06;
    const R = (Math.min(this.w, this.h) / 2) * 0.52 * p.scale * breath;
    return { cx: this.w / 2, cy: this.h / 2, R, big: this.w > 140 };
  }

  _view(pt, tilt, spin) {
    const ca = Math.cos(spin), sa = Math.sin(spin);
    const x = pt[0] * ca - pt[2] * sa;
    let z = pt[0] * sa + pt[2] * ca;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const y = pt[1] * ct - z * st;
    z = pt[1] * st + z * ct;
    return { x, y, z };
  }

  _project(pt, R, cx, cy, tilt, spin) {
    const v = this._view(pt, tilt, spin);
    return { sx: cx + v.x * R, sy: cy + v.y * R, z: v.z, front: v.z > 0 };
  }

  _place(pt, radius, cx, cy, tilt, spin) {
    const v = this._view(pt, tilt, spin);
    return { sx: cx + v.x * radius, sy: cy + v.y * radius, z: v.z, front: v.z > 0, x: v.x, y: v.y };
  }

  _shellRadius() {
    return (Math.min(this.w, this.h) / 2) * 0.5;
  }

  _core(ctx, cx, cy, r, t) {
    const dpr = this._effectiveDpr();
    const key = `${Math.round(r * dpr)}:${t.core1}:${t.core2}`;
    if (!this._coreCache || this._coreCache.key !== key) {
      const cssSize = (r + CORE_PAD) * 2;
      const offscreen = this._makeOffscreen(cssSize * dpr, cssSize * dpr);
      if (offscreen) {
        this._releaseCacheCanvas(this._coreCache);
        const { canvas, ctx: octx } = offscreen;
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const oc = cssSize / 2;
        const g = octx.createRadialGradient(oc - r * 0.34, oc - r * 0.38, r * 0.05, oc, oc, r);
        g.addColorStop(0, t.core2);
        g.addColorStop(0.7, t.core1);
        g.addColorStop(1, t.core1);
        octx.fillStyle = g;
        octx.beginPath();
        octx.arc(oc, oc, r, 0, Math.PI * 2);
        octx.fill();
        this._coreCache = { key, canvas, cssSize };
      } else {
        this._coreCache = null;
      }
    }
    if (this._coreCache?.key === key) {
      const half = this._coreCache.cssSize / 2;
      ctx.drawImage(this._coreCache.canvas, cx - half, cy - half, this._coreCache.cssSize, this._coreCache.cssSize);
      return;
    }
    const g = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.38, r * 0.05, cx, cy, r);
    g.addColorStop(0, t.core2);
    g.addColorStop(0.7, t.core1);
    g.addColorStop(1, t.core1);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /* 错误态：白色散射事件视界包住纯黑实心核。 */
  _errorHorizon(ctx, cx, cy, r) {
    const settle = ease(this.mix);
    const pulse = 0.86 + 0.14 * Math.sin(this.time * 2.2);
    ctx.save();
    ctx.lineCap = "round";
    // Lightweight soft stroke replaces per-frame shadowBlur.
    ctx.strokeStyle = `rgba(255,255,255,${(0.18 * settle * pulse).toFixed(3)})`;
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.035, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = `rgba(255,255,255,${(0.68 * settle * pulse).toFixed(3)})`;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.035, 0, Math.PI * 2);
    ctx.stroke();

    // 放射线的内外端点都落在近似同心圆上，整体轮廓明确读成圆形。
    const rays = 72;
    for (let i = 0; i < rays; i++) {
      const seed = 0.5 + 0.5 * Math.sin(i * 12.9898 + 2.41);
      const a = (i / rays) * Math.PI * 2 + Math.sin(this.time * 0.72 + i * 1.73) * 0.012;
      const ca = Math.cos(a), sa = Math.sin(a);
      const inner = r * (1.05 + Math.sin(i * 2.37 + this.time * 1.2) * 0.008);
      const outer = r * (1.19 + Math.sin(i * 1.91 - this.time * 1.05) * 0.012);
      ctx.globalAlpha = (0.3 + seed * 0.5) * settle * pulse;
      ctx.lineWidth = 0.45 + seed * 0.75;
      ctx.beginPath();
      ctx.moveTo(cx + ca * inner, cy + sa * inner);
      ctx.lineTo(cx + ca * outer, cy + sa * outer);
      ctx.stroke();
    }

    ctx.globalAlpha = 0.07 * settle;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.19, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.2 * settle;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.19, 0, Math.PI * 2);
    ctx.stroke();

    // 最内层保持完全实心，白边只存在于黑核外侧。
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#010205";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _dot(ctx, x, y, r, color, alpha) {
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  _draw() {
    const { ctx, w, h } = this;
    const p = this._params();
    const t = this._tokens();
    const g = this._geom(p);
    ctx.clearRect(0, 0, w, h);
    if (this.luminous) {this._drawDust(ctx, g);this._drawLuminousOrbits(ctx, g, false);}
    const fn = {
      particle: this._drawParticle, matrix: this._drawMatrix, orbit: this._drawOrbit,
      wire: this._drawWire, glass: this._drawGlass, aura: this._drawAura,
      ink: this._drawInk, pulse: this._drawPulse,
    }[this.variant] ?? this._drawParticle;
    fn.call(this, ctx, g, p, t);
    if (this.luminous) this._drawLuminousOrbits(ctx, g, true);
    this._drawStateRing(ctx, g, p, t);
    ctx.globalAlpha = 1;
  }

  _drawDust(ctx, {cx, cy}) {
    const R = this._shellRadius();
    const fade = this.state === 'error' ? this._errorFade() : 1;
    const turn = this.calm ? 0 : this.time * .018;
    // Transparent local light filaments; the workspace acrylic remains the backdrop.
    ctx.save();
    const mist=ctx.createLinearGradient(cx-R*2.9,cy,cx+R*2.9,cy);
    mist.addColorStop(0,'rgba(255,255,255,0)');mist.addColorStop(.3,'rgba(255,255,255,.08)');mist.addColorStop(.58,'rgba(255,255,255,.2)');mist.addColorStop(1,'rgba(255,255,255,0)');
    ctx.strokeStyle=mist;ctx.lineWidth=.6;ctx.globalAlpha=fade;
    for(let line=0;line<7;line++){
      const offset=line*2.2;
      ctx.beginPath();ctx.moveTo(cx-R*2.9,cy+R*.96+offset);
      ctx.bezierCurveTo(cx-R*.6,cy+R*1.18-offset,cx+R*.4,cy+R*.22+offset,cx+R*2.9,cy+R*.5+offset);ctx.stroke();
    }
    ctx.lineWidth=2.2;ctx.globalAlpha=fade*.22;
    for(let line=0;line<7;line+=2){
      const offset=line*2.2;
      ctx.beginPath();ctx.moveTo(cx-R*2.9,cy+R*.96+offset);
      ctx.bezierCurveTo(cx-R*.6,cy+R*1.18-offset,cx+R*.4,cy+R*.22+offset,cx+R*2.9,cy+R*.5+offset);ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle='#ffffff';
    const rY = R * 0.72, shimmerTime = this.time * 0.55;
    for (let i = 0; i < this.dust.length; i++) {
      const dust = this.dust[i];
      const angle = dust.angle + turn;
      const base = dust.baseAlpha ?? (Math.min(.7, dust.alpha * 1.45) * Math.max(0, 1 - (dust.radius - 1.14) / 1.8));
      const shimmer = this.calm ? 1 : .84 + .16 * Math.sin(shimmerTime + dust.phase);
      const alpha = base * shimmer * fade;
      if (alpha <= 0.004) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * R * dust.radius, cy + Math.sin(angle) * rY * dust.radius, dust.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Two depth passes let the sphere occlude the far side of each orbital path.
  _drawLuminousOrbits(ctx, {cx, cy}, front) {
    const R=this._shellRadius(),fade=this.state==='error'?this._errorFade():1;
    const time=this.calm?0:this.time;
    const planes=[[2.65,.48,-.28,.13],[2.2,.52,.85,-.1],[1.94,.5,-1.02,.08],
      [2.78,.73,.09,-.065],[2.36,.7,-.58,.09],[1.83,.64,1.22,-.075]];
    ctx.save();ctx.lineCap='round';
    for(const [index,[major,minor,rotation,speed]] of planes.entries()){
      const c=Math.cos(rotation),s=Math.sin(rotation),rMaj=R*major,rMin=R*minor;
      const point=angle=>{const x=Math.cos(angle)*rMaj,y=Math.sin(angle)*rMin;return {x:cx+x*c-y*s,y:cy+x*s+y*c};};
      const start=front?0:Math.PI;
      ctx.beginPath();
      for(let step=0;step<=80;step++){const pointAt=point(start+step*Math.PI/80);if(step===0)ctx.moveTo(pointAt.x,pointAt.y);else ctx.lineTo(pointAt.x,pointAt.y);}
      const strength=index<3?1:.55;
      ctx.strokeStyle=`rgba(255,255,255,${(front?.36:.11)*fade*strength})`;ctx.lineWidth=front?.65:.5;ctx.stroke();
      const phase=(time*speed+index*2.1+.6)%(Math.PI*2),isFront=Math.sin(phase)>=0;
      if(isFront===front){
      // A short bright wake gives the moving node direction without a hard UI ring.
      const direction=Math.sign(speed);
      for(let segment=0;segment<12;segment++){
        const a=phase-direction*(12-segment)*.024,b=a+direction*.026,from=point(a),to=point(b);
        ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.strokeStyle=`rgba(255,255,255,${(.045+segment*.035)*fade})`;ctx.lineWidth=.7;ctx.stroke();
      }
      const node=point(phase);this._drawLuminousStar(ctx,node.x,node.y,(index===0?2:1.5)*(front?1:.78),fade*(front?1:.5));
      }
      const opposite=phase+Math.PI;
      if((Math.sin(opposite)>=0)===front){const p=point(opposite);this._drawLuminousStar(ctx,p.x,p.y,1.1,fade*.6);}
    }
    ctx.restore();
  }

  _drawLuminousStar(ctx,x,y,size,alpha){
    const clamped=Math.max(0,Math.min(1,alpha));
    if(clamped<=0.004)return;
    if(!this._starSprite){
      const offscreen=this._makeOffscreen(LUMINOUS_STAR_PX,LUMINOUS_STAR_PX);
      if(offscreen){
        const {canvas,ctx:octx}=offscreen;
        const c=LUMINOUS_STAR_PX/2,starR=c/6;
        const glow=octx.createRadialGradient(c,c,0,c,c,c);
        glow.addColorStop(0,'rgba(255,255,255,.65)');glow.addColorStop(.2,'rgba(255,255,255,.15)');glow.addColorStop(1,'rgba(255,255,255,0)');
        octx.fillStyle=glow;octx.beginPath();octx.arc(c,c,c,0,Math.PI*2);octx.fill();
        octx.strokeStyle='rgba(255,255,255,.32)';octx.lineWidth=Math.max(.5,starR*.35);
        octx.beginPath();octx.moveTo(c-starR*3.5,c);octx.lineTo(c+starR*3.5,c);octx.moveTo(c,c-starR*2.8);octx.lineTo(c,c+starR*2.8);octx.stroke();
        octx.fillStyle='#ffffff';octx.beginPath();octx.arc(c,c,starR,0,Math.PI*2);octx.fill();
        this._starSprite={canvas};
      }
    }
    if(this._starSprite){
      const r=size*6,prev=ctx.globalAlpha;
      ctx.globalAlpha=clamped;
      ctx.drawImage(this._starSprite.canvas,x-r,y-r,r*2,r*2);
      ctx.globalAlpha=prev;
      return;
    }
    ctx.save();ctx.globalAlpha=clamped;
    const glow=ctx.createRadialGradient(x,y,0,x,y,size*6);
    glow.addColorStop(0,'rgba(255,255,255,.65)');glow.addColorStop(.2,'rgba(255,255,255,.15)');glow.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,size*6,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.32)';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(x-size*3.5,y);ctx.lineTo(x+size*3.5,y);ctx.moveTo(x,y-size*2.8);ctx.lineTo(x,y+size*2.8);ctx.stroke();
    this._dot(ctx,x,y,size,'#ffffff',clamped);ctx.restore();
  }

  _paintLuminousCore(targetCtx,cx,cy,R){
    targetCtx.save();
    const bloom=targetCtx.createRadialGradient(cx,cy,R*.4,cx,cy,R*1.3);
    bloom.addColorStop(0,'rgba(255,255,255,0)');bloom.addColorStop(.69,'rgba(255,255,255,0)');bloom.addColorStop(.8,'rgba(255,255,255,.11)');bloom.addColorStop(1,'rgba(255,255,255,0)');
    targetCtx.fillStyle=bloom;targetCtx.beginPath();targetCtx.arc(cx,cy,R*1.3,0,Math.PI*2);targetCtx.fill();
    const surface=targetCtx.createRadialGradient(cx-R*.52,cy-R*.58,R*.06,cx,cy,R*1.04);
    surface.addColorStop(0,'#33363a');surface.addColorStop(.24,'#181b1f');surface.addColorStop(.6,'#08090b');surface.addColorStop(1,'#010203');
    targetCtx.fillStyle=surface;targetCtx.beginPath();targetCtx.arc(cx,cy,R*1.025,0,Math.PI*2);targetCtx.fill();
    const rim=targetCtx.createLinearGradient(cx-R,cy-R,cx+R,cy+R);
    rim.addColorStop(0,'rgba(255,255,255,1)');rim.addColorStop(.3,'rgba(255,255,255,.95)');rim.addColorStop(.54,'rgba(255,255,255,.18)');rim.addColorStop(.8,'rgba(255,255,255,.72)');rim.addColorStop(1,'rgba(255,255,255,.4)');
    targetCtx.strokeStyle=rim;targetCtx.lineWidth=1.35;targetCtx.shadowColor='rgba(255,255,255,.65)';targetCtx.shadowBlur=5;targetCtx.beginPath();targetCtx.arc(cx,cy,R*1.025,0,Math.PI*2);targetCtx.stroke();
    targetCtx.shadowBlur=0;targetCtx.strokeStyle='rgba(255,255,255,.15)';targetCtx.lineWidth=.5;targetCtx.beginPath();targetCtx.arc(cx,cy,R*.985,0,Math.PI*2);targetCtx.stroke();
    targetCtx.strokeStyle='rgba(255,255,255,.9)';targetCtx.shadowColor='#fff';targetCtx.shadowBlur=9;targetCtx.lineWidth=1.9;targetCtx.beginPath();targetCtx.arc(cx,cy,R*1.025,Math.PI*1.02,Math.PI*1.57);targetCtx.stroke();
    targetCtx.restore();
  }

  _drawLuminousCore(ctx,cx,cy,R){
    const dpr=this._effectiveDpr();
    const key=String(Math.round(R*dpr));
    if(!this._luminousCoreCache||this._luminousCoreCache.key!==key){
      const cssSize=Math.ceil(R*2.8);
      const offscreen=this._makeOffscreen(cssSize*dpr,cssSize*dpr);
      if(offscreen){
        this._releaseCacheCanvas(this._luminousCoreCache);
        const {canvas,ctx:octx}=offscreen;
        octx.setTransform(dpr,0,0,dpr,0,0);
        this._paintLuminousCore(octx,cssSize/2,cssSize/2,R);
        this._luminousCoreCache={key,canvas,cssSize};
      }else{
        this._luminousCoreCache=null;
      }
    }
    if(this._luminousCoreCache?.key===key){
      const half=this._luminousCoreCache.cssSize/2;
      ctx.drawImage(this._luminousCoreCache.canvas,cx-half,cy-half,this._luminousCoreCache.cssSize,this._luminousCoreCache.cssSize);
      return;
    }
    this._paintLuminousCore(ctx,cx,cy,R);
  }

  /* 形态 1：粒子球壳 */
  _drawParticle(ctx, g, p, t) {
    const { cx, cy, R, big } = g;
    const coreR = R * 0.66;
    if (this.state === "error") this._errorHorizon(ctx, cx, cy, coreR);
    else this._core(ctx, cx, cy, coreR, t);
    const tilt = p.tilt + (this.calm ? 0 : Math.sin(this.time * 0.22) * 0.05);
    const mixA = ease(this.mix);
    const fA = SHAPES[this.shapeFrom] ?? SHAPES.sphere;
    const fB = SHAPES[this.shapeTo] ?? SHAPES.sphere;
    const jitA = this.calm ? 0 : 0.012;
    const fade = this._errorFade();
    const flash = this._flash();
    const collapse = 0.55 + 0.45 * fade;
    const pts = (this._particlePool ??= []);
    let count = 0;
    if (fade > 0.02) {
      const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      for (const pt of this.points) {
        const a = fA(pt), b = fB(pt);
        const c = pt.u < mixA ? b : a;
        const j = jitA * Math.sin(this.time * 1.5 + pt.seed * 26);
        const px = c[0] + j, py = c[1] + j * 0.6, pz = c[2];
        const vx = px * ca - pz * sa;
        const rz = px * sa + pz * ca;
        const vy = py * ct - rz * st;
        const vz = py * st + rz * ct;
        const r = R * this._spread(pt) * collapse;
        const slot = pts[count] ?? (pts[count] = { sx: 0, sy: 0, z: 0, front: false });
        slot.sx = cx + vx * r;
        slot.sy = cy + vy * r;
        slot.z = vz;
        slot.front = vz > 0;
        count++;
      }
    }
    pts.length = count;
    pts.sort((a2, b2) => a2.z - b2.z);
    ctx.fillStyle = t.particle;
    const baseSize = (big ? 1.4 : 1.05) * (0.6 + 0.5 * 0.6);
    const occludeR = coreR * 1.02;
    for (let i = 0; i < count; i++) {
      const d = pts[i];
      // 遮住黑核的那批粒子不画：否则正面密集成一片白，读不出「黑核 + 白粒」
      if (Math.hypot(d.sx - cx, d.sy - cy) < occludeR) continue;
      const depth = Math.max(0, (d.z + 1.3) / 2.3);
      // 正面粒子接近纯白满亮度，背面只留轮廓
      const alpha = p.bright * (d.front ? 0.72 + depth * 0.28 : 0.16 + depth * 0.18) * flash * fade;
      if (alpha <= 0.004) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      const size = baseSize * (d.front ? 1.15 : 0.8);
      ctx.beginPath();
      ctx.arc(d.sx, d.sy, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* 形态 2：粒子包住整颗黑球。待机自转，语音跟音量，思考和执行呼吸。 */
  _drawMatrix(ctx, g, p, t) {
    const { cx, cy, big } = g;
    const R = this._shellRadius();
    const kind = this._kind();
    const coreR = R * 0.64;
    if (kind === "collapse") {
      this._drawCollapse(ctx, { cx, cy, R, big }, coreR);
      return;
    }
    if(this.luminous)this._drawLuminousCore(ctx,cx,cy,R);else this._core(ctx, cx, cy, coreR, t);
    const tilt = kind === "earth" ? EARTH_TILT : kind === "breath" ? 0.5 : 0.28;
    const gestured = this.breathUntil != null && this.time < this.breathUntil;
    const breathPhase = gestured ? (this.time - this.breathOrigin) / 3.2 : this.time / 3.2;
    const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const sourcePts = this.luminous ? (this._luminousPts ??= this._buildLuminousPts(this.points)) : this.points;
    const dots = (this._dotPool ??= []);
    const voiceAmp = this.level;
    const freqWobble = 2.6 + voiceAmp * 8.5, freqSway = 1.8 + voiceAmp * 4.2;
    for (let i = 0; i < sourcePts.length; i++) {
      const pt = sourcePts[i];
      let x = pt.x, y = pt.y, z = pt.z;
      let radial = 1.04, gain = 1;
      if (kind === "voice") {
        const wobble = Math.sin(this.time * freqWobble + pt.seed * 29);
        const sway = voiceAmp * 0.2 * Math.sin(this.time * freqSway + pt.u * 13);
        x += z * sway;
        z -= pt.x * sway;
        y += x * sway * 0.28;
        const len = Math.hypot(x, y, z) || 1;
        x /= len; y /= len; z /= len;
        radial *= 1 + voiceAmp * (0.08 + 0.5 * (0.5 + 0.5 * wobble));
        gain = 0.88 + 0.12 * voiceAmp * (0.5 + 0.5 * wobble);
      } else if (kind === "breath") {
        const sample = breathSample(breathPhase + pt.seed * 0.03);
        radial *= sample.radius;
        gain = 0.74 + 0.26 * sample.bright;
      }
      const vx = x * ca - z * sa;
      const rz = x * sa + z * ca;
      const vy = y * ct - rz * st;
      const vz = y * st + rz * ct;
      const radius = R * radial;
      const depth = Math.max(0, Math.min(1, (vz + 1.15) / 2.15));
      let light = 0.78 + 0.22 * depth;
      if (kind === "earth") {
        const sun = vx * 0.62 + vz * 0.72 + vy * 0.18;
        light = 0.74 + 0.26 * Math.max(0, Math.min(1, sun * 0.5 + 0.5));
      }
      const slot = dots[i] ?? (dots[i] = { sx: 0, sy: 0, z: 0, seed: 0, alpha: 0 });
      slot.sx = cx + vx * radius;
      slot.sy = cy + vy * radius;
      slot.z = vz;
      slot.seed = pt.seed;
      slot.alpha = Math.max(0, Math.min(1, gain * light));
    }
    dots.length = sourcePts.length;
    dots.sort((a, b) => a.z - b.z);
    ctx.fillStyle = "#ffffff";
    const starSizeMul = big ? 1.6 : 1.2;
    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      const depth = Math.max(0, Math.min(1, (dot.z + 1.15) / 2.15));
      const size = this.luminous ? .35 + depth * .85 + dot.seed * .38 : starSizeMul * (0.82 + 0.38 * depth);
      let alpha = dot.alpha;
      if (this.luminous) {
        const silhouette = Math.hypot(dot.sx - cx, dot.sy - cy) / R;
        alpha *= dot.z < 0 ? .09 + .22 * Math.pow(silhouette, 5) : .52 + .48 * depth;
      }
      if (alpha > 0.004) {
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, size, 0, Math.PI * 2);
        ctx.fill();
      }
      if (this.luminous && dot.z > 0 && dot.seed > .96) {
        this._drawLuminousStar(ctx, dot.sx, dot.sy, size * .72, alpha * .7);
        ctx.fillStyle = "#ffffff";
      }
    }
    ctx.globalAlpha = 1;
  }

  /* 失败：粒子旋进黑核，留下包住黑球的光滑白粒子光圈。 */
  _drawCollapse(ctx, g, coreR) {
    const { cx, cy, R, big } = g;
    const fall = this.calm ? 1 : ease(this.mix);
    const pool = (this._collapsePool ??= []);
    if (fall < 0.985) {
      const spin = this.angle + fall * 6, ca = Math.cos(spin), sa = Math.sin(spin);
      const ct = Math.cos(EARTH_TILT), st = Math.sin(EARTH_TILT);
      const radius = R * lerp(1.04, 0.16, fall);
      for (let i = 0; i < this.points.length; i++) {
        const pt = this.points[i];
        const vx = pt.x * ca - pt.z * sa;
        const rz = pt.x * sa + pt.z * ca;
        const vy = pt.y * ct - rz * st;
        const vz = pt.y * st + rz * ct;
        const slot = pool[i] ?? (pool[i] = { sx: 0, sy: 0, z: 0 });
        slot.sx = cx + vx * radius; slot.sy = cy + vy * radius; slot.z = vz;
      }
      pool.length = this.points.length;
      pool.sort((a, b) => a.z - b.z);
      ctx.fillStyle = "#ffffff";
      const fSize = big ? 1.45 : 1.15;
      for (let i = 0; i < pool.length; i++) {
        const dot = pool[i];
        const depth = Math.max(0, (dot.z + 1.1) / 2.1);
        ctx.globalAlpha = Math.max(0, Math.min(1, (1 - fall) * (0.55 + 0.45 * depth)));
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, fSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const hole = coreR * (1 + 0.16 * fall);
    const body = ctx.createRadialGradient(cx - hole * 0.2, cy - hole * 0.24, hole * 0.05, cx, cy, hole);
    body.addColorStop(0, "#161b22");
    body.addColorStop(0.55, "#05070a");
    body.addColorStop(1, "#000000");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, hole, 0, Math.PI * 2);
    ctx.fill();

    const haloR = hole * 1.18;
    const hSpin = this.angle * 0.45, hca = Math.cos(hSpin), hsa = Math.sin(hSpin);
    const hct = Math.cos(0.46), hst = Math.sin(0.46);
    for (let i = 0; i < COLLAPSE_HALO_PTS.length; i++) {
      const pt = COLLAPSE_HALO_PTS[i];
      const vx = pt.x * hca - pt.z * hsa;
      const rz = pt.x * hsa + pt.z * hca;
      const vy = pt.y * hct - rz * hst;
      const vz = pt.y * hst + rz * hct;
      const slot = pool[i] ?? (pool[i] = { sx: 0, sy: 0, z: 0 });
      slot.sx = cx + vx * haloR; slot.sy = cy + vy * haloR; slot.z = vz;
    }
    pool.length = COLLAPSE_HALO_PTS.length;
    pool.sort((a, b) => a.z - b.z);
    ctx.fillStyle = "#ffffff";
    const hBase = big ? 1.9 : 1.45;
    for (let i = 0; i < pool.length; i++) {
      const dot = pool[i];
      const depth = Math.max(0, Math.min(1, (dot.z + 1) / 2));
      ctx.globalAlpha = Math.max(0, Math.min(1, fall * (0.62 + 0.38 * depth)));
      ctx.beginPath();
      ctx.arc(dot.sx, dot.sy, hBase * (0.92 + 0.2 * depth), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${(0.14 * fall).toFixed(3)})`;
    ctx.lineWidth = big ? 4.4 : 3.2;
    ctx.beginPath();
    ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${(0.42 * fall).toFixed(3)})`;
    ctx.lineWidth = big ? 1.6 : 1.15;
    ctx.beginPath();
    ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* 形态 3：极简轨道 */
  _drawOrbit(ctx, g, p, t) {
    const { cx, cy, R } = g;
    this._core(ctx, cx, cy, R * 0.62, t);
    const orbits = this.state === "executing" ? 2 : 1;
    const n = this.state === "waiting" ? 2 : 5;
    for (let o = 0; o < orbits; o++) {
      const tilt = p.tilt + o * 1.15;
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      const spin = o ? this.angle2 : this.angle;
      ctx.strokeStyle = t.particle;
      ctx.lineWidth = 0.8;
      ctx.globalAlpha = p.bright * 0.14;
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const x = Math.cos(a) * 1.24, z = Math.sin(a) * 1.24;
        const sx = cx + x * R, sy = cy + (-z * st) * R;
        i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
      }
      ctx.stroke();
      ctx.fillStyle = t.particle;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + spin * 2;
        const x = Math.cos(a) * 1.24, z = Math.sin(a) * 1.24;
        const vy = -z * st, vz = z * ct, front = vz > 0;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.bright * (front ? 1 : 0.22)));
        ctx.beginPath();
        ctx.arc(cx + x * R, cy + vy * R, front ? 2.1 : 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* 形态 4：线框球 */
  _drawWire(ctx, g, p, t) {
    const { cx, cy, R } = g;
    const tilt = p.tilt + 0.2;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = t.particle;
    const rings = this.state === "thinking" ? 10 : 7;
    for (let i = 1; i < rings; i++) {
      const phi = (i / rings) * Math.PI;
      const y = Math.cos(phi), r = Math.sin(phi);
      ctx.globalAlpha = p.bright * (0.1 + 0.26 * Math.abs(r));
      ctx.beginPath();
      for (let j = 0; j <= 48; j++) {
        const a = (j / 48) * Math.PI * 2 + this.angle;
        const px = Math.cos(a) * r, pz = Math.sin(a) * r;
        const sx = cx + px * R, sy = cy + (y * ct - pz * st) * R;
        j ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
      }
      ctx.stroke();
    }
    for (let k = 0; k < 5; k++) {
      const a0 = (k / 5) * Math.PI + this.angle;
      const ca0 = Math.cos(a0), sa0 = Math.sin(a0);
      ctx.globalAlpha = p.bright * 0.14;
      ctx.beginPath();
      for (let j = 0; j <= 40; j++) {
        const phi = (j / 40) * Math.PI;
        const sp = Math.sin(phi), cp = Math.cos(phi);
        const px = ca0 * sp, pz = sa0 * sp;
        const sx = cx + px * R, sy = cy + (cp * ct - pz * st) * R;
        j ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
      }
      ctx.stroke();
    }
    this._core(ctx, cx, cy, R * (this.state === "listening" ? 0.42 : 0.56), t);
    ctx.globalAlpha = 1;
  }

  /* 形态 5：玻璃球 */
  _drawGlass(ctx, g, p, t) {
    const { cx, cy, R } = g;
    const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.42, R * 0.1, cx, cy, R);
    body.addColorStop(0, "rgba(255,255,255,0.30)");
    body.addColorStop(0.45, "rgba(255,255,255,0.07)");
    body.addColorStop(1, "rgba(255,255,255,0.16)");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = p.bright;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.globalAlpha = p.bright * 0.8;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.ellipse(cx - R * 0.28, cy - R * 0.46, R * 0.3, R * 0.14, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = p.bright * 0.35;
    ctx.beginPath();
    ctx.ellipse(cx + R * 0.2, cy + R * 0.62, R * 0.34, R * 0.09, 0.2, 0, Math.PI * 2);
    ctx.fill();
    this._core(ctx, cx, cy + Math.sin(this.angle) * R * 0.06, R * 0.32, t);
    ctx.globalAlpha = 1;
  }

  /* 形态 6：亮白光团 */
  _drawAura(ctx, g, p, t) {
    const { cx, cy, R } = g;
    const rad = R * (1.15 + this.level * 0.12);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, `rgba(255,255,255,${(0.95 * p.bright).toFixed(3)})`);
    grad.addColorStop(0.35, `rgba(255,255,255,${(0.4 * p.bright).toFixed(3)})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
    if (this.state === "thinking" || this.state === "executing") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
  }

  /* 形态 7：墨滴 */
  _drawInk(ctx, g, p, t) {
    const { cx, cy, R } = g;
    const spikes = this.state === "error" ? 7 : this.state === "thinking" ? 4 : 2;
    const amp = (this.state === "listening" ? 0.14 : 0.07) * (this.calm ? 0.3 : 1);
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const wob = 1 + Math.sin(a * spikes + this.angle * 2) * amp + Math.sin(a * 3 - this.angle) * amp * 0.5;
      const r = R * 0.86 * wob;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = t.core1;
    ctx.fill();
    ctx.globalAlpha = p.bright * 0.45;
    ctx.strokeStyle = t.particle;
    ctx.lineWidth = 1;
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + this.angle;
      const r = R * (1.02 + Math.sin(a * 2 + this.time) * 0.05);
      this._dot(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.5, t.particle, p.bright);
    }
    ctx.globalAlpha = 1;
  }

  /* 形态 8：脉冲环 */
  _drawPulse(ctx, g, p, t) {
    const { cx, cy, R } = g;
    this._core(ctx, cx, cy, R * 0.6, t);
    ctx.strokeStyle = t.particle;
    const rate = this.state === "waiting" ? 0 : this.state === "thinking" ? 1.6 : 0.9;
    if (rate === 0) {
      ctx.globalAlpha = p.bright * 0.5;
      ctx.lineWidth = 1;
      ctx.setLineDash([1.5, 5]);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      for (let i = 0; i < 3; i++) {
        const ph = (this.time * rate + i / 3) % 1;
        ctx.globalAlpha = p.bright * (1 - ph) * 0.8;
        ctx.lineWidth = 1.2 * (1 - ph) + 0.3;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (0.7 + ph * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* 状态环：执行=可计量进度；不可计量用稀疏虚线，不做假百分比 */
  _drawStateRing(ctx, g, p, t) {
    if (["aura", "glass"].includes(this.variant) || (this.variant === "matrix" && this.state === "executing")) return;
    const { cx, cy, R, big } = g;
    const ringR = R * 1.42;
    const st = this.state;
    ctx.lineWidth = big ? 1.5 : 1.1;
    if (st === "executing") {
      ctx.strokeStyle = t.accent;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      if (this.progress && this.progress.totalUnits) {
        const frac = Math.max(0.02, Math.min(1, this.progress.completedUnits / this.progress.totalUnits));
        ctx.arc(cx, cy, ringR, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.setLineDash([2, 8]);
        ctx.arc(cx, cy, ringR, this.angle * 3, this.angle * 3 + Math.PI * 1.1);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (st === "waiting") {
      ctx.strokeStyle = t.accent;
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([1.5, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  dispose() {
    this.stop();
    this._observer?.disconnect();
    this._dropRenderCaches();
    this._dotPool = [];
    this._particlePool = [];
    this._collapsePool = [];
    if (this._onPreferences) window.removeEventListener?.("preferences-changed", this._onPreferences);
  }
}
