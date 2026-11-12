// "How it works": a pinned, full-bleed world map. The same land mask as the hero (Canvas 2D here, so the page
// keeps one WebGL context), a camera that moves between the four beats, and the money drawn as 25 dots per payment:
// 23 to the merchant, 2 to the tax vault (the demo's tax_bps 800 = 92 / 8).
// The places on the map mean nothing; they are only where the dots are easy to follow.
// Without JS, with reduced motion or Save-Data this never runs; the section shows four stills (public/assets/story-N.webp
// and story-mN.webp, rendered by scripts/make-story-stills.mjs from this same code) with the captions.

type Pt = [number, number]; // lon, lat
type Win = Window & { __story?: { force: (p: number | null) => void; ready: boolean; ms?: number } };
type Nav = Navigator & { connection?: { saveData?: boolean } };

const GRID = 1.8; // degrees between dots
const LAT_MIN = -57;
const LAT_MAX = 84;
const N = 25;
const N_MERCHANT = 23;
const INV_A = 'INV-1111-V32-A';
const INV_B = 'INV-1111-V32-B';

const PAYER: Pt = [-90, 40];
const ADDR_A: Pt = [10, 50];
const MERCHANT: Pt = [70, 24];
const VAULT: Pt = [-48, -14];
const WALLET: Pt = [118, -24];
const ADDR_B: Pt = [20, 6];
const ANYONE: Pt = [-80, 14];

// camera keyframes along u = progress * 4 (beat i spans u in [i, i+1])
const KEYS: { u: number; c: Pt; z: number }[] = [
  { u: 0, c: [10, 46], z: 1.9 },
  { u: 0.9, c: [10, 46], z: 2.4 },
  { u: 1.12, c: [-12, 32], z: 1.15 },
  { u: 1.92, c: [-8, 26], z: 1.0 },
  { u: 2.15, c: [68, 2], z: 1.2 },
  { u: 2.92, c: [68, 2], z: 1.1 },
  { u: 3.15, c: [20, 18], z: 1.0 },
  { u: 4, c: [14, 18], z: 0.9 },
];

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hash = (i: number) => { const s = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return s - Math.floor(s); };
const spiral = (i: number, gap: number): [number, number] => {
  const r = gap * Math.sqrt(i + 0.5);
  const th = i * 2.399963;
  return [r * Math.cos(th), r * Math.sin(th)];
};

const widths = new Map<string, number>(); // measureText is slow: label widths are cached per font size

function camera(u: number) {
  u = clamp(u, 0, 4);
  let i = 0;
  while (i < KEYS.length - 2 && u > KEYS[i + 1].u) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = smooth(0, 1, (u - a.u) / (b.u - a.u));
  return { lon: lerp(a.c[0], b.c[0], t), lat: lerp(a.c[1], b.c[1], t), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), t)) };
}

/** The state the live chip shows at u: which invoice, and what the chain would say about it. */
function chipAt(u: number): [string, string] {
  if (u < 1.45) return [INV_A, 'NONEXISTENT'];
  if (u < 2.0) return [INV_A, 'PAID'];
  if (u < 2.45) return [INV_B, 'NONEXISTENT'];
  if (u < 3.4) return [INV_B, 'UNINITIALIZED'];
  return [INV_B, 'PAID'];
}

function boot() {
  const root = document.querySelector<HTMLElement>('[data-story]');
  if (!root) return;
  const win = window as Win;
  const canvas = root.querySelector<HTMLCanvasElement>('canvas');
  const stage = root.querySelector<HTMLElement>('.story-stage');
  const driver = root.querySelector<HTMLElement>('.story-driver');
  const items = Array.from(root.querySelectorAll<HTMLElement>('.story-steps > li'));
  const invEl = root.querySelector<HTMLElement>('[data-story-inv]');
  const chipEl = root.querySelector<HTMLElement>('[data-story-chip]');
  const chipText = chipEl?.querySelector('b');
  const bars = Array.from(root.querySelectorAll<HTMLElement>('.story-bars span'));
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });
  if (!canvas || !stage || !driver || !ctx || items.length !== 4) return;
  const stillMode = new URLSearchParams(location.search).has('still');
  if (!stillMode) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if ((navigator as Nav).connection?.saveData) return;
  }
  const ps = stillMode ? 1.5 : 1; // px scale: the stills are shown smaller than they are drawn

  const css = getComputedStyle(document.documentElement);
  const paper = css.getPropertyValue('--paper').trim() || '#F6F5F1';
  const ink = css.getPropertyValue('--ink').trim() || '#111110';
  const green = css.getPropertyValue('--paid-on-ink').trim() || '#7FC4A0';

  let land: Float32Array | null = null; // lon, lat pairs
  let buckets: Float32Array[] = [];
  let W = 1, H = 1, dpr = 1, narrow = false;
  let cur = 0, target = 0, forced: number | null = null;
  let visible = false, raf = 0, last = 0, drawn = -1;
  let chipKey = '';

  // ---- land mask -> dots on a fixed 1.8 degree grid (same texture as the hero shader) ----
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const out: number[] = [];
    for (let lat = LAT_MIN + GRID / 2; lat < LAT_MAX; lat += GRID) {
      for (let lon = -180 + GRID / 2; lon < 180; lon += GRID) {
        const x = Math.min(c.width - 1, Math.floor(((lon + 180) / 360) * c.width));
        const y = Math.min(c.height - 1, Math.floor(((90 - lat) / 180) * c.height));
        if (px[(y * c.width + x) * 4] / 255 > 0.55) out.push(lon, lat);
      }
    }
    land = new Float32Array(out);
    buckets = [0, 1, 2].map(() => new Float32Array(out.length));
    drawn = -1;
    win.__story!.ready = true;
    schedule();
  };
  img.src = '/assets/landmask.png';

  function resize() {
    const r = stage!.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    narrow = W < 768;
    canvas!.width = Math.round(W * dpr);
    canvas!.height = Math.round(H * dpr);
    drawn = -1;
    schedule();
  }

  // ---- scroll -> progress in [0, 1] with a short hold at both ends ----
  function progress(): number {
    if (forced !== null) return forced;
    const r = driver!.getBoundingClientRect();
    const span = r.height - stage!.getBoundingClientRect().height;
    const p = clamp(-r.top / Math.max(1, span));
    return clamp((p - 0.04) / 0.92);
  }

  function draw(p: number) {
    const c = ctx!;
    const u = p * 4;
    const b = Math.min(3, Math.floor(u));
    const t = u - b;
    const cam = camera(u);
    const k0 = W / (narrow ? 230 : 300);
    const k = k0 * cam.z;
    const sx = W * 0.5;
    const sy = H * (stillMode ? 0.5 : narrow ? 0.31 : 0.38);
    const proj = (pt: Pt): [number, number] => [sx + (pt[0] - cam.lon) * k, sy - (pt[1] - cam.lat) * k];

    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = ink;
    c.fillRect(0, 0, W, H);

    // land: three alpha bands so the edges of the frame fall away
    if (land) {
      const pitch = GRID * k;
      const rad = Math.max(0.5, pitch * 0.27);
      // the fade-out ellipse is centred on the map, and on phones it is not stretched to the full height
      const rx = W * 0.5, ry = narrow ? Math.min(H * 0.5, W * 0.85) : H * 0.5;
      const vy = narrow && !stillMode ? sy : H * 0.5;
      const cnt = [0, 0, 0];
      for (let i = 0; i < land.length; i += 2) {
        const x = sx + (land[i] - cam.lon) * k;
        const y = sy - (land[i + 1] - cam.lat) * k;
        if (x < -8 || x > W + 8 || y < -8 || y > H + 8) continue;
        const dx = (x - W * 0.5) / rx, dy = (y - vy) / ry;
        const d2 = dx * dx + dy * dy;
        const band = d2 < 0.3 ? 0 : d2 < 0.81 ? 1 : 2;
        const bk = buckets[band];
        bk[cnt[band]++] = x;
        bk[cnt[band]++] = y;
      }
      const alphas = [0.4, 0.26, 0.13];
      c.fillStyle = paper;
      for (let band = 0; band < 3; band++) {
        c.globalAlpha = alphas[band];
        c.beginPath();
        const bk = buckets[band];
        for (let i = 0; i < cnt[band]; i += 2) {
          c.moveTo(bk[i] + rad, bk[i + 1]);
          c.arc(bk[i], bk[i + 1], rad, 0, Math.PI * 2);
        }
        c.fill();
      }
    }

    // ---- helpers bound to this frame ----
    const lift = 0.2;
    const arcAt = (a: [number, number], bpt: [number, number]) => {
      const dx = bpt[0] - a[0], dy = bpt[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      let nx = dy / len, ny = -dx / len;
      if (ny > 0) { nx = -nx; ny = -ny; }
      const cx = (a[0] + bpt[0]) / 2 + nx * len * lift;
      const cy = (a[1] + bpt[1]) / 2 + ny * len * lift;
      return (s: number): [number, number] => {
        const m = 1 - s;
        return [m * m * a[0] + 2 * m * s * cx + s * s * bpt[0], m * m * a[1] + 2 * m * s * cy + s * s * bpt[1]];
      };
    };
    const guide = (a: Pt, bpt: Pt, alpha: number) => {
      if (alpha <= 0.01) return;
      const f = arcAt(proj(a), proj(bpt));
      c.globalAlpha = alpha;
      c.strokeStyle = paper;
      c.lineWidth = 0.8 * ps;
      c.beginPath();
      for (let i = 0; i <= 28; i++) { const [x, y] = f(i / 28); i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    };
    const dot = (x: number, y: number, r: number, col: string, alpha: number) => {
      if (alpha <= 0.01) return;
      c.globalAlpha = alpha;
      c.fillStyle = col;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    };
    const ring = (x: number, y: number, r: number, col: string, alpha: number, o: { dash?: boolean; w?: number; fill?: number } = {}) => {
      if (alpha <= 0.01) return;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      if (o.fill) { c.globalAlpha = alpha * o.fill; c.fillStyle = col; c.fill(); }
      c.globalAlpha = alpha;
      c.strokeStyle = col;
      c.lineWidth = (o.w ?? 1.2) * ps;
      c.setLineDash(o.dash ? [3 * ps, 3 * ps] : []);
      c.stroke();
      c.setLineDash([]);
    };
    const ripple = (x: number, y: number, tt: number, col: string, maxR = 46) => {
      if (tt <= 0 || tt >= 1) return;
      ring(x, y, (8 + maxR * ease(tt)) * ps, col, 0.5 * (1 - tt), { w: 1 });
    };
    const fontPx = (narrow ? 11.5 : 13) * ps;
    c.font = `${fontPx}px "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace`;
    c.textBaseline = 'middle';
    // a label sits on a dark plate so it stays readable over the dots
    const label = (s: string, x: number, y: number, alpha: number, col = paper) => {
      if (alpha <= 0.01) return;
      c.textAlign = 'center';
      const wk = fontPx + s;
      let w = widths.get(wk);
      if (w === undefined) { w = c.measureText(s).width; widths.set(wk, w); }
      const padX = 6 * ps, h = fontPx + 8 * ps;
      c.globalAlpha = Math.min(0.82, alpha);
      c.fillStyle = ink;
      c.beginPath();
      if (c.roundRect) c.roundRect(x - w / 2 - padX, y - h / 2, w + padX * 2, h, 4 * ps);
      else c.rect(x - w / 2 - padX, y - h / 2, w + padX * 2, h);
      c.fill();
      c.globalAlpha = alpha;
      c.fillStyle = col;
      c.fillText(s, x, y + 0.5);
    };
    const R = (narrow ? 2.1 : 2.5) * ps; // dot radius
    const gapAcc = 2.6 * ps, gapOut = (narrow ? 4.8 : 5.8) * ps;
    const RING = 9 * ps;

    // flight of dot i of n between two points, with a short trail
    const fly = (i: number, tt: number, t0: number, t1: number) => clamp(((tt - t0) / (t1 - t0)) * 1.6 - (0.6 * i) / (N - 1));
    const offsetAt = (pt: [number, number], slot: [number, number]): [number, number] => [pt[0] + slot[0], pt[1] + slot[1]];

    // draw one dot at progress s (0..1) along path f, with a short trail while it moves
    const travel = (f: (s: number) => [number, number], s: number, seed: number, col: string, alpha: number) => {
      const wob = Math.sin(Math.PI * s) * (seed - 0.5) * 18 * ps;
      const [x, y] = f(ease(s));
      dot(x, y + wob, R, col, alpha);
      if (s > 0 && s < 1) {
        for (let tr = 1; tr <= 3; tr++) {
          const [tx, ty] = f(ease(clamp(s - tr * 0.035)));
          dot(tx, ty + wob, R * (1 - tr * 0.2), col, alpha * (0.34 - tr * 0.08));
        }
      }
    };

    const pP = proj(PAYER), pA = proj(ADDR_A), pM = proj(MERCHANT), pV = proj(VAULT);
    const pW = proj(WALLET), pB = proj(ADDR_B), pS = proj(ANYONE);

    const dimA = 1 - 0.45 * smooth(2, 2.25, u);
    const showMV = smooth(1.5, 1.62, u);

    // guides
    guide(PAYER, ADDR_A, 0.2 * smooth(1.0, 1.12, u));
    guide(ADDR_A, MERCHANT, 0.16 * showMV * dimA);
    guide(ADDR_A, VAULT, 0.16 * showMV * dimA);
    guide(WALLET, ADDR_B, 0.2 * smooth(2.0, 2.12, u));
    guide(ANYONE, ADDR_B, 0.2 * smooth(3.0, 3.1, u));
    guide(ADDR_B, MERCHANT, 0.16 * smooth(3.25, 3.4, u));
    guide(ADDR_B, VAULT, 0.16 * smooth(3.25, 3.4, u));

    // ---- invoice A ----
    const created = u < 1 ? 0 : smooth(1.32, 1.5, u);
    const aIn = smooth(0, 0.25, u);
    if (created < 0.5) ring(pA[0], pA[1], RING, paper, 0.9 * aIn * (1 - created * 2), { dash: true });
    ring(pA[0], pA[1], RING, green, dimA * clamp(created * 2 - 0.2), { fill: 0.18 * created, w: 1.6 });
    dot(pA[0], pA[1], 1.6 * ps, paper, aIn * dimA * (created > 0.5 ? 0 : 0.9));
    if (b === 0) for (let r = 0; r < 2; r++) ripple(pA[0], pA[1], (t * 1.5 + r * 0.5) % 1, paper, 38);
    if (b === 1) ripple(pA[0], pA[1], (t - 0.38) / 0.3, green, 52);
    label(INV_A, pA[0], pA[1] - 46 * ps, smooth(0.15, 0.4, u) * dimA);
    label('0ue8ts6vvgpq…qazs62g', pA[0], pA[1] - 27 * ps, smooth(0.25, 0.5, u) * dimA);
    if (u < 1.05) label('chain says: UNKNOWN_ACCOUNT', pA[0], pA[1] + 32 * ps, smooth(0.45, 0.75, u) * (1 - smooth(0.95, 1.05, u)));

    // ---- merchant and vault ----
    if (showMV > 0.01) {
      ring(pM[0], pM[1], 5 * ps, green, 0.7 * showMV, { w: 1 });
      ring(pV[0], pV[1], 7 * ps, green, 0.8 * showMV, { w: 1.2 });
      label('merchant', pM[0], pM[1] - 48 * ps, 0.95 * showMV);
      label('tax vault', pV[0], pV[1] + 30 * ps, 0.95 * showMV);
      // amounts are the recorded ones for invoice A only
      const amt = smooth(1.85, 1.97, u) * (1 - smooth(2.2, 2.4, u));
      if (amt > 0.01) {
        label('92%  0.92 NEAR', pM[0], pM[1] - 70 * ps, amt, green);
        label('8%  0.08 NEAR', pV[0], pV[1] + 52 * ps, amt, green);
      }
    }

    // ---- payer ----
    const payerIn = smooth(1.0, 1.1, u) * (1 - 0.5 * smooth(2, 2.25, u));
    if (payerIn > 0.01) {
      ring(pP[0], pP[1], 5 * ps, paper, 0.8 * payerIn, { w: 1 });
      dot(pP[0], pP[1], 1.6 * ps, paper, payerIn);
      label('payer', pP[0], pP[1] - 20 * ps, 0.95 * payerIn);
    }

    // ---- the 25 dots of payment A: payer -> account -> merchant / vault ----
    if (u >= 1) {
      for (let i = 0; i < N; i++) {
        const s1 = fly(i, b === 1 ? t : 1, 0.08, 0.5);
        if (s1 <= 0) continue;
        const rest = offsetAt(pA, spiral(i, gapAcc));
        const split = b === 1 ? fly(i, t, 0.55, 0.95) : 1;
        const out = offsetAt(i < N_MERCHANT ? pM : pV, spiral(i < N_MERCHANT ? i : i - N_MERCHANT, gapOut));
        if (split > 0) travel(arcAt(rest, out), split, hash(i + 9), green, dimA);
        else travel(arcAt(pP, rest), s1, hash(i), paper, dimA);
      }
    }

    // ---- invoice B: wallet -> account (waits) -> sweep -> merchant / vault ----
    if (u >= 2) {
      const bIn = smooth(2.0, 2.12, u);
      const holds = u >= 2.45; // money has reached the account: it exists, without code
      const litB = u < 3 ? 0 : smooth(3.3, 3.45, u);
      ring(pB[0], pB[1], RING, paper, 0.8 * bIn * (1 - litB), { w: holds ? 1.4 : 1.2, dash: !holds });
      ring(pB[0], pB[1], RING, green, bIn * litB, { fill: 0.18 * litB, w: 1.6 });
      if (b === 3) ripple(pB[0], pB[1], (t - 0.32) / 0.3, green, 52);
      label(INV_B, pB[0], pB[1] + (narrow ? 30 : -46) * ps, 0.95 * bIn);
      if (!narrow) label('0u2kmvc0zc7h…9c0km0xr0', pB[0], pB[1] - 27 * ps, 0.95 * smooth(2.1, 2.3, u));
      if (u < 3.25) label('uninitialized: 1 NEAR waiting', pB[0], pB[1] + (narrow ? 52 : 32) * ps, smooth(2.78, 2.95, u) * (1 - smooth(3.15, 3.28, u)));

      const wIn = smooth(2.0, 2.1, u) * (1 - 0.5 * smooth(3.0, 3.2, u));
      ring(pW[0], pW[1], 5 * ps, paper, 0.8 * wIn, { w: 1 });
      dot(pW[0], pW[1], 1.6 * ps, paper, wIn);
      label('wallet', pW[0], pW[1] + 22 * ps, 0.95 * wIn);

      const sIn = smooth(3.0, 3.1, u);
      if (sIn > 0.01) {
        ring(pS[0], pS[1], 5 * ps, paper, 0.8 * sIn, { w: 1, dash: true });
        label('anyone', pS[0], pS[1] + 22 * ps, 0.95 * sIn);
        // one pulse along the line to the account: the sweep call
        if (b === 3) {
          const sp = clamp((t - 0.05) / 0.25);
          if (sp > 0 && sp < 1) {
            const f = arcAt(pS, pB);
            const [x, y] = f(ease(sp));
            dot(x, y, 3.2 * ps, paper, 0.95);
            label('sweep()', x, y - 16 * ps, 0.95 * (1 - sp * 0.4));
          }
        }
      }

      for (let i = 0; i < N; i++) {
        const arrive = fly(i, b === 2 ? t : 1, 0.05, 0.85);
        if (arrive <= 0) continue;
        const rest = offsetAt(pB, spiral(i, gapAcc));
        const split = b === 3 ? fly(i, t, 0.3, 0.88) : u >= 4 ? 1 : 0;
        // the merchant and vault clusters already hold payment A: B's dots take the next slots
        const out = offsetAt(i < N_MERCHANT ? pM : pV, spiral(i < N_MERCHANT ? N_MERCHANT + i : 2 + (i - N_MERCHANT), gapOut));
        if (split > 0) travel(arcAt(rest, out), split, hash(i + 70), green, 1);
        else travel(arcAt(pW, rest), arrive, hash(i + 30), paper, arrive >= 1 ? 0.55 : 0.95);
      }
    }
    c.globalAlpha = 1;

    // captions, state chip and progress bars follow the picture
    items.forEach((li, i) => li.classList.toggle('on', i === b));
    const [inv, state] = chipAt(u);
    if (inv + state !== chipKey) {
      chipKey = inv + state;
      if (invEl) invEl.textContent = inv;
      if (chipEl) chipEl.dataset.s = state;
      if (chipText) chipText.textContent = state;
    }
    bars.forEach((el, i) => el.style.setProperty('--f', String(clamp(u - i))));
    drawn = p;
  }

  function frame(now: number) {
    raf = 0;
    if (!visible || document.hidden || !land) return;
    target = progress();
    const dt = last ? Math.min(64, now - last) : 16.7;
    last = now;
    const k = forced !== null ? 1 : 1 - Math.pow(1 - 0.14, dt / 16.7);
    cur += (target - cur) * k;
    if (Math.abs(target - cur) < 0.0003) cur = target;
    if (cur !== drawn) { const t0 = performance.now(); draw(cur); win.__story!.ms = performance.now() - t0; }
    if (cur !== target) schedule();
    else last = 0;
  }
  function schedule() { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); }

  win.__story = {
    ready: false,
    force: (p) => { forced = p; if (p !== null) { cur = p; drawn = -1; } schedule(); },
  };

  addEventListener('scroll', schedule, { passive: true });
  document.addEventListener('visibilitychange', schedule);
  new ResizeObserver(resize).observe(stage);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) { last = 0; schedule(); } }, { rootMargin: '200px 0px' }).observe(root);
  // canvas text needs Geist Mono: redraw once it is loaded
  document.fonts?.ready.then(() => { drawn = -1; schedule(); });

  root.classList.add('story-live');
  resize();
  cur = target = progress();
}

try { boot(); } catch (err) { console.warn('story disabled:', err); }
