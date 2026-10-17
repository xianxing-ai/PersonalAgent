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
    this._rebuild();
    this._resize();
    this._observer = new ResizeObserver(() => {
      this._resize();
      if (!this.running) this._draw();
    });
    this._observer.observe(canvas.parentElement ?? canvas);
    this.start();
  }

  _rebuild() {
    this.points = this.layout === "lattice" ? latticeRings() : fibonacciSphere(this.count);
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(rect.width, 24);
    this.h = Math.max(rect.height, 24);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
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
    const out = {};
    for (const k of Object.keys(this.to)) out[k] = lerp(this.from[k], this.to[k], ease(this.mix));
    return out;
  }

  start() {
    if (this.running || this.calm) return;
    this.running = true;
    const loop = (t) => {
      if (!this.running) return;
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
    const css = getComputedStyle(this.canvas);
    const v = (n, fb) => (css.getPropertyValue(n).trim() || fb);
    return {
      particle: v("--orb-particle", "#ffffff"),
      core1: v("--orb-core-1", "#05070a"),
      core2: v("--orb-core-2", "#10151c"),
      accent: v("--accent", "#52c7bd"),
      danger: v("--danger", "#ef6a72"),
    };
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
    ctx.strokeStyle = `rgba(255,255,255,${(0.68 * settle * pulse).toFixed(3)})`;
    ctx.lineWidth = 1.25;
    ctx.shadowColor = "rgba(255,255,255,0.72)";
    ctx.shadowBlur = 4.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.035, 0, Math.PI * 2);
    ctx.stroke();

    // 放射线的内外端点都落在近似同心圆上，整体轮廓明确读成圆形。
    const rays = 72;
    for (let i = 0; i < rays; i++) {
      const seed = 0.5 + 0.5 * Math.sin(i * 12.9898 + 2.41);
      const a = (i / rays) * Math.PI * 2 + Math.sin(this.time * 0.72 + i * 1.73) * 0.012;
      const inner = r * (1.05 + Math.sin(i * 2.37 + this.time * 1.2) * 0.008);
      const outer = r * (1.19 + Math.sin(i * 1.91 - this.time * 1.05) * 0.012);
      const alpha = (0.3 + seed * 0.5) * settle * pulse;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 0.45 + seed * 0.75;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ctx.stroke();
    }

    ctx.globalAlpha = 0.2 * settle;
    ctx.lineWidth = 0.7;
    ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.19, 0, Math.PI * 2);
    ctx.stroke();

    // 最内层保持完全实心，白边只存在于黑核外侧。
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
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
    const fn = {
      particle: this._drawParticle, matrix: this._drawMatrix, orbit: this._drawOrbit,
      wire: this._drawWire, glass: this._drawGlass, aura: this._drawAura,
      ink: this._drawInk, pulse: this._drawPulse,
    }[this.variant] ?? this._drawParticle;
    fn.call(this, ctx, g, p, t);
    this._drawStateRing(ctx, g, p, t);
    ctx.globalAlpha = 1;
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
    const pts = [];
    if (fade > 0.02) {
      for (const pt of this.points) {
        const a = fA(pt), b = fB(pt);
        const c = pt.u < mixA ? b : a;
        const j = jitA * Math.sin(this.time * 1.5 + pt.seed * 26);
        pts.push(this._project([c[0] + j, c[1] + j * 0.6, c[2]], R * this._spread(pt) * collapse, cx, cy, tilt, this.angle));
      }
    }
    pts.sort((a2, b2) => a2.z - b2.z);
    for (const d of pts) {
      // 遮住黑核的那批粒子不画：否则正面密集成一片白，读不出「黑核 + 白粒」
      if (Math.hypot(d.sx - cx, d.sy - cy) < coreR * 1.02) continue;
      const depth = Math.max(0, (d.z + 1.3) / 2.3);
      // 正面粒子接近纯白满亮度，背面只留轮廓
      const alpha = p.bright * (d.front ? 0.72 + depth * 0.28 : 0.16 + depth * 0.18) * flash * fade;
      const size = (big ? 1.4 : 1.05) * (0.6 + (d.seed ?? 0.5) * 0.6) * (d.front ? 1.15 : 0.8);
      this._dot(ctx, d.sx, d.sy, size, t.particle, alpha);
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
    this._core(ctx, cx, cy, coreR, t);
    const tilt = kind === "earth" ? EARTH_TILT : kind === "breath" ? 0.5 : 0.28;
    const gestured = this.breathUntil != null && this.time < this.breathUntil;
    const breathPhase = gestured ? (this.time - this.breathOrigin) / 3.2 : this.time / 3.2;
    const dots = [];
    for (const pt of this.points) {
      let x = pt.x;
      let y = pt.y;
      let z = pt.z;
      let radial = 1.04;
      let gain = 1;
      if (kind === "voice") {
        const amp = this.level;
        const wobble = Math.sin(this.time * (2.6 + amp * 8.5) + pt.seed * 29);
        const sway = amp * 0.2 * Math.sin(this.time * (1.8 + amp * 4.2) + pt.u * 13);
        x += z * sway;
        z -= pt.x * sway;
        y += x * sway * 0.28;
        const len = Math.hypot(x, y, z) || 1;
        x /= len; y /= len; z /= len;
        radial *= 1 + amp * (0.08 + 0.5 * (0.5 + 0.5 * wobble));
        gain = 0.88 + 0.12 * amp * (0.5 + 0.5 * wobble);
      } else if (kind === "breath") {
        const sample = breathSample(breathPhase + pt.seed * 0.03);
        radial *= sample.radius;
        gain = 0.74 + 0.26 * sample.bright;
      }
      const placed = this._place([x, y, z], R * radial, cx, cy, tilt, this.angle);
      const depth = Math.max(0, Math.min(1, (placed.z + 1.15) / 2.15));
      let light = 0.78 + 0.22 * depth;
      if (kind === "earth") {
        const sun = placed.x * 0.62 + placed.z * 0.72 + placed.y * 0.18;
        light = 0.74 + 0.26 * Math.max(0, Math.min(1, sun * 0.5 + 0.5));
      }
      dots.push({ ...placed, seed: pt.seed, alpha: Math.max(0, Math.min(1, gain * light)) });
    }
    dots.sort((a, b) => a.z - b.z);
    for (const dot of dots) {
      const depth = Math.max(0, Math.min(1, (dot.z + 1.15) / 2.15));
      const size = (big ? 1.6 : 1.2) * (0.82 + 0.38 * depth);
      this._dot(ctx, dot.sx, dot.sy, size, "#ffffff", dot.alpha);
    }
    ctx.globalAlpha = 1;
  }

  /* 失败：粒子旋进黑核，留下包住黑球的光滑白粒子光圈。 */
  _drawCollapse(ctx, g, coreR) {
    const { cx, cy, R, big } = g;
    const fall = this.calm ? 1 : ease(this.mix);
    if (fall < 0.985) {
      const falling = [];
      for (const pt of this.points) {
        const radius = R * lerp(1.04, 0.16, fall);
        falling.push(this._place([pt.x, pt.y, pt.z], radius, cx, cy, EARTH_TILT, this.angle + fall * 6));
      }
      falling.sort((a, b) => a.z - b.z);
      for (const dot of falling) {
        const depth = Math.max(0, (dot.z + 1.1) / 2.1);
        this._dot(ctx, dot.sx, dot.sy, big ? 1.45 : 1.15, "#ffffff", (1 - fall) * (0.55 + 0.45 * depth));
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
    const count = 84;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const halo = [];
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      halo.push(this._place(
        [Math.cos(theta) * ring, y, Math.sin(theta) * ring],
        haloR, cx, cy, 0.46, this.angle * 0.45,
      ));
    }
    halo.sort((a, b) => a.z - b.z);
    for (const dot of halo) {
      const depth = Math.max(0, Math.min(1, (dot.z + 1) / 2));
      this._dot(ctx, dot.sx, dot.sy, (big ? 1.9 : 1.45) * (0.92 + 0.2 * depth), "#ffffff", fall * (0.62 + 0.38 * depth));
    }
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${(0.42 * fall).toFixed(3)})`;
    ctx.shadowColor = "rgba(255,255,255,0.75)";
    ctx.shadowBlur = big ? 10 : 6;
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
      const spin = o ? this.angle2 : this.angle;
      ctx.strokeStyle = t.particle;
      ctx.lineWidth = 0.8;
      ctx.globalAlpha = p.bright * 0.14;
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const d = this._project([Math.cos(a) * 1.24, 0, Math.sin(a) * 1.24], R, cx, cy, tilt, 0);
        i ? ctx.lineTo(d.sx, d.sy) : ctx.moveTo(d.sx, d.sy);
      }
      ctx.stroke();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + spin * 2;
        const d = this._project([Math.cos(a) * 1.24, 0, Math.sin(a) * 1.24], R, cx, cy, tilt, 0);
        this._dot(ctx, d.sx, d.sy, d.front ? 2.1 : 1.2, t.particle, p.bright * (d.front ? 1 : 0.22));
      }
    }
    ctx.globalAlpha = 1;
  }

  /* 形态 4：线框球 */
  _drawWire(ctx, g, p, t) {
    const { cx, cy, R } = g;
    const tilt = p.tilt + 0.2;
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = t.particle;
    const rings = this.state === "thinking" ? 10 : 7;
    for (let i = 1; i < rings; i++) {
      const phi = (i / rings) * Math.PI;
      const y = Math.cos(phi), r = Math.sin(phi);
      ctx.globalAlpha = p.bright * (0.1 + 0.26 * Math.abs(Math.sin(phi)));
      ctx.beginPath();
      for (let j = 0; j <= 48; j++) {
        const a = (j / 48) * Math.PI * 2 + this.angle;
        const d = this._project([Math.cos(a) * r, y, Math.sin(a) * r], R, cx, cy, tilt, 0);
        j ? ctx.lineTo(d.sx, d.sy) : ctx.moveTo(d.sx, d.sy);
      }
      ctx.stroke();
    }
    for (let k = 0; k < 5; k++) {
      const a0 = (k / 5) * Math.PI + this.angle;
      ctx.globalAlpha = p.bright * 0.14;
      ctx.beginPath();
      for (let j = 0; j <= 40; j++) {
        const phi = (j / 40) * Math.PI;
        const d = this._project([Math.cos(a0) * Math.sin(phi), Math.cos(phi), Math.sin(a0) * Math.sin(phi)], R, cx, cy, tilt, 0);
        j ? ctx.lineTo(d.sx, d.sy) : ctx.moveTo(d.sx, d.sy);
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
  }
}
