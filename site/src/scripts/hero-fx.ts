// Hero overlay: the demo invoice card comes alive in a loop that follows the recorded states.
// NONEXISTENT (dashed ring on the map, address resolves, 0 transactions) -> one payment of 25 dots arrives,
// the ring turns solid, the card reads PAID and 1 transaction -> 23 dots to the merchant, 2 to the tax vault -> reset.
// 23 / 25 = 92%, 2 / 25 = 8%, the demo's tax_bps 800. The places on the map mean nothing.
// Skipped under reduced motion and Save-Data (the card stays in its first state), and without JS.
import { heroGeo } from '../hero-geo';

type Pt = [number, number]; // lon, lat
type Nav = Navigator & { connection?: { saveData?: boolean } };

const N = 25;
const N_MERCHANT = 23;
const ADDR: Pt = [10, 48];
const PAYER: Pt = [112, 38];
const MERCHANT: Pt = [34, 6];
const VAULT: Pt = [80, 22];

// seconds
const T = { ring: 0.2, payer: 2.2, fly0: 2.8, fly1: 4.9, created: 4.0, split0: 4.9, split1: 6.9, out0: 9.4, out1: 10.3, end: 10.8 };

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const hash = (i: number) => { const s = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return s - Math.floor(s); };
const spiral = (i: number, gap: number): [number, number] => {
  const r = gap * Math.sqrt(i + 0.5);
  const th = i * 2.399963;
  return [r * Math.cos(th), r * Math.sin(th)];
};

const widths = new Map<string, number>();

function boot() {
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  const canvas = hero?.querySelector<HTMLCanvasElement>('.hero-fx');
  const card = hero?.querySelector<HTMLElement>('[data-hc]');
  // willReadFrequently keeps this a CPU-backed canvas: the GPU-backed one stalled for seconds in headless SwiftShader
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });
  if (!hero || !canvas || !card || !ctx) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if ((navigator as Nav).connection?.saveData) return;

  const chip = card.querySelector<HTMLElement>('[data-hc-chip]')!;
  const chipText = chip.querySelector('b')!;
  const addr = card.querySelector<HTMLElement>('[data-hc-addr]')!;
  const chain = card.querySelector<HTMLElement>('[data-hc-chain]')!;
  const tx = card.querySelector<HTMLElement>('[data-hc-tx]')!;
  const finalAddr = addr.dataset.final ?? addr.textContent ?? '';

  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--ink').trim() || '#111110';
  const green = css.getPropertyValue('--paid').trim() || '#1F4D3A';
  const paper = css.getPropertyValue('--paper').trim() || '#F6F5F1';

  let W = 1, H = 1, CH = 1, dpr = 1; // CH: height of the overlay canvas (phones: only the map band)
  let visible = true, raf = 0, t0 = 0, lastDraw = 0;
  let stateKey = '';
  let leader: [number, number] = [0, 0]; // where the card's top-left corner is, in hero px

  function resize() {
    const r = hero!.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const g = heroGeo(W, H);
    CH = g.narrow ? Math.min(H, Math.ceil(g.mapBottom + 50)) : H;
    canvas!.style.height = `${CH}px`;
    canvas!.width = Math.round(W * dpr);
    canvas!.height = Math.round(CH * dpr);
    const cr = card!.getBoundingClientRect();
    leader = [cr.left - r.left + 18, cr.top - r.top];
  }

  // the address resolves character by character, like a hash being worked out
  const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyz';
  let scrambleStart = -1;
  function scramble(now: number) {
    if (scrambleStart < 0) return;
    const el = (now - scrambleStart) / 1000;
    let out = '';
    let done = true;
    for (let i = 0; i < finalAddr.length; i++) {
      const ch = finalAddr[i];
      if (ch === '…' || i < 2 || el > 0.25 + i * 0.045) out += ch;
      else { out += ALPHA[Math.floor(hash(i + Math.floor(el * 24)) * ALPHA.length)]; done = false; }
    }
    addr.textContent = out;
    if (done) { scrambleStart = -1; addr.textContent = finalAddr; }
  }

  function setState(state: 'NONEXISTENT' | 'PAID') {
    if (state === stateKey) return;
    stateKey = state;
    chip.dataset.s = state;
    chipText.textContent = state;
    chain.textContent = state === 'PAID' ? 'status=PAID' : 'UNKNOWN_ACCOUNT';
    tx.textContent = state === 'PAID' ? '1' : '0';
    for (const el of [chain, tx, chip]) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }

  function draw(now: number) {
    raf = 0;
    if (!visible || document.hidden) return;
    // 30 fps is plenty for dots this small, and halves the compositing work
    if (now - lastDraw < 30) { schedule(); return; }
    lastDraw = now;
    if (!t0) t0 = now;
    const t = ((now - t0) / 1000) % T.end;
    if (t < 0.05 && scrambleStart < 0) scrambleStart = now;
    scramble(now);

    const geo = heroGeo(W, H);
    const P = geo.project;
    const pa = P(...ADDR), pp = P(...PAYER), pm = P(...MERCHANT), pv = P(...VAULT);
    const fade = 1 - smooth(T.out0, T.out1, t); // everything fades before the loop restarts
    const created = smooth(T.created, T.created + 0.5, t);
    setState(t >= T.created + 0.25 && t < T.out1 ? 'PAID' : 'NONEXISTENT');

    const c = ctx!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, CH);

    const dot = (x: number, y: number, r: number, col: string, a: number) => {
      if (a <= 0.01) return;
      c.globalAlpha = a; c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    };
    const ring = (x: number, y: number, r: number, col: string, a: number, o: { dash?: boolean; w?: number; fill?: number } = {}) => {
      if (a <= 0.01) return;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
      if (o.fill) { c.globalAlpha = a * o.fill; c.fillStyle = col; c.fill(); }
      c.globalAlpha = a; c.strokeStyle = col; c.lineWidth = o.w ?? 1.2; c.setLineDash(o.dash ? [3, 3] : []); c.stroke(); c.setLineDash([]);
    };
    const arcAt = (a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      let nx = dy / len, ny = -dx / len;
      if (ny > 0) { nx = -nx; ny = -ny; }
      const cx = (a[0] + b[0]) / 2 + nx * len * 0.2, cy = (a[1] + b[1]) / 2 + ny * len * 0.2;
      return (s: number): [number, number] => { const m = 1 - s; return [m * m * a[0] + 2 * m * s * cx + s * s * b[0], m * m * a[1] + 2 * m * s * cy + s * s * b[1]]; };
    };
    const plate = (s: string, x: number, y: number, a: number, col = ink) => {
      if (a <= 0.01) return;
      c.font = '11.5px "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      let w = widths.get(s);
      if (w === undefined) { w = c.measureText(s).width; widths.set(s, w); }
      c.globalAlpha = a * 0.85; c.fillStyle = paper;
      c.beginPath();
      if (c.roundRect) c.roundRect(x - w / 2 - 5, y - 10, w + 10, 20, 4); else c.rect(x - w / 2 - 5, y - 10, w + 10, 20);
      c.fill();
      c.globalAlpha = a; c.fillStyle = col; c.fillText(s, x, y + 0.5);
    };

    // leader line from the ring to the card (wide screens: the card sits at the bottom right)
    if (!geo.narrow) {
      const [cx, cy] = leader;
      c.globalAlpha = 0.3 * smooth(T.ring, T.ring + 0.8, t) * fade;
      c.strokeStyle = ink; c.lineWidth = 1; c.setLineDash([2, 4]);
      c.beginPath(); c.moveTo(pa[0], pa[1] + 12); c.lineTo(cx, cy); c.stroke(); c.setLineDash([]);
      dot(cx, cy, 2.2, ink, 0.5 * smooth(T.ring, T.ring + 0.8, t) * fade);
    }

    // address ring: dashed while the account does not exist, solid green once it does
    const ringIn = smooth(T.ring, T.ring + 0.7, t) * fade;
    const r0 = 9;
    if (created < 0.5) ring(pa[0], pa[1], r0, ink, 0.85 * ringIn * (1 - created * 2), { dash: true });
    ring(pa[0], pa[1], r0, green, ringIn * clamp(created * 2 - 0.2), { fill: 0.16 * created, w: 1.6 });
    if (created < 0.5) dot(pa[0], pa[1], 1.7, ink, ringIn);
    // slow ripples while nothing exists yet
    if (t < T.created) for (let r = 0; r < 2; r++) {
      const ph = ((t - T.ring) * 0.55 + r * 0.5) % 1;
      if (t > T.ring) ring(pa[0], pa[1], r0 + 34 * ease(ph), ink, 0.28 * (1 - ph) * ringIn, { w: 1 });
    }
    const since = t - T.created;
    if (since > 0.1 && since < 1.1) { const ph = (since - 0.1) / 1.0; ring(pa[0], pa[1], r0 + 46 * ease(ph), green, 0.5 * (1 - ph) * fade, { w: 1 }); }

    // payer, merchant, vault
    const payerIn = smooth(T.payer, T.payer + 0.5, t) * fade;
    ring(pp[0], pp[1], 5, ink, 0.8 * payerIn, { w: 1 });
    dot(pp[0], pp[1], 1.6, ink, payerIn);
    plate('payer', pp[0], pp[1] - 18, 0.95 * payerIn);
    const mvIn = smooth(T.split0 - 0.4, T.split0 + 0.2, t) * fade;
    ring(pm[0], pm[1], 5, green, 0.75 * mvIn, { w: 1 });
    ring(pv[0], pv[1], 6, green, 0.8 * mvIn, { w: 1.2 });
    plate('merchant', pm[0], pm[1] - 42, 0.95 * mvIn);
    plate('tax vault', pv[0], pv[1] - 20, 0.95 * mvIn);
    const share = smooth(T.split1 - 0.3, T.split1 + 0.3, t) * fade;
    plate('92%', pm[0], pm[1] - 64, 0.95 * share, green);
    plate('8%', pv[0], pv[1] - 42, 0.95 * share, green);

    // the 25 dots
    const R = 2.4;
    for (let i = 0; i < N; i++) {
      const stagger = 0.6 * (i / (N - 1));
      const a = clamp(((t - T.fly0) / (T.fly1 - T.fly0)) * 1.6 - stagger);
      if (a <= 0) continue;
      const rest: [number, number] = [pa[0] + spiral(i, 2.6)[0], pa[1] + spiral(i, 2.6)[1]];
      const b = clamp(((t - T.split0) / (T.split1 - T.split0)) * 1.6 - stagger);
      const dest = i < N_MERCHANT ? pm : pv;
      const slot = spiral(i < N_MERCHANT ? i : i - N_MERCHANT, 5.4);
      const out: [number, number] = [dest[0] + slot[0], dest[1] + slot[1]];
      const moving = b > 0 ? b : a;
      const f = b > 0 ? arcAt(rest, out) : arcAt(pp, rest);
      const e = ease(moving);
      const wob = Math.sin(Math.PI * moving) * (hash(i + (b > 0 ? 9 : 0)) - 0.5) * 16;
      const [x, y] = f(e);
      const col = b > 0 ? green : ink;
      dot(x, y + wob, R, col, fade);
      if (moving > 0 && moving < 1) for (let tr = 1; tr <= 3; tr++) {
        const [tx2, ty2] = f(ease(clamp(moving - tr * 0.035)));
        dot(tx2, ty2 + wob, R * (1 - tr * 0.2), col, fade * (0.34 - tr * 0.08));
      }
    }
    c.globalAlpha = 1;
    schedule();
  }

  function schedule() { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(draw); }

  // a non-critical enhancement: start after the page has loaded and gone quiet, so it never competes with the first paint
  const start = () => {
    new ResizeObserver(resize).observe(hero);
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) schedule(); }).observe(hero);
    document.addEventListener('visibilitychange', schedule);
    resize();
    document.fonts?.ready.then(() => schedule());
    schedule();
  };
  const afterLoad = () => setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(start, { timeout: 2500 }) : start()), 1200);
  if (document.readyState === 'complete') afterLoad();
  else addEventListener('load', afterLoad, { once: true });
}

try { boot(); } catch (err) { console.warn('hero overlay disabled:', err); }
