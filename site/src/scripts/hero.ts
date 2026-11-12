// Hero: one fullscreen quad, one land luminance texture, one 256x256 R8 influence texture.
// Dots sit on a fixed grid; the cursor only raises dot size/ink on land. Nothing displaces the coastline.

const VERT = `#version 300 es
in vec2 a;
void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;        // device px
uniform float u_cell;      // device px per grid cell
uniform float u_k;         // device px per degree
uniform vec2 u_origin;     // device px (top-down) where lon/lat centre sits
uniform vec2 u_centre;     // lon, lat at u_origin
uniform vec3 u_ink;
uniform float u_narrow;  // 1.0 when the text block sits under the map
uniform float u_mapb;    // narrow only: device px where the map ends and the text begins
uniform sampler2D u_land;
uniform sampler2D u_infl;
out vec4 o;
void main(){
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 cell = floor(p / u_cell);
  vec2 c = (cell + 0.5) * u_cell;
  float lon = u_centre.x + (c.x - u_origin.x) / u_k;
  float lat = u_centre.y - (c.y - u_origin.y) / u_k;
  float land = 0.0;
  if (lat < 84.0 && lat > -57.0) {
    vec2 uv = vec2(fract((lon + 180.0) / 360.0), (90.0 - lat) / 180.0);
    land = texture(u_land, uv).r;
  }
  float infl = texture(u_infl, c / u_res).r;
  float body = smoothstep(0.3, 0.85, land);
  float r = u_cell * 0.5 * body * (0.40 + 0.38 * infl);
  float d = length(p - c);
  float aa = 1.0 - smoothstep(r - 0.6, r + 0.6, d);
  // keep the headline area calm: nearly no dots behind the text block (lower-left on wide screens, lower part on narrow ones)
  vec2 s = c / u_res;
  float wide = max(smoothstep(0.50, 0.72, s.x), 1.0 - smoothstep(0.30, 0.46, s.y));
  float tall = 1.0 - smoothstep(u_mapb * 0.92, max(u_mapb * 1.12, u_mapb * 0.92 + 1.0), c.y);
  float calm = mix(0.06, 1.0, mix(wide, tall, u_narrow));
  float alpha = aa * mix(0.5, 1.0, infl) * calm * step(0.5, body);
  o = vec4(u_ink * alpha, alpha);
}`;

import { heroGeo, HERO_CENTRE } from '../hero-geo';

const INK: [number, number, number] = [17 / 255, 17 / 255, 16 / 255];
const N = 256;

function boot() {
  const root = document.querySelector<HTMLElement>('.hero-map');
  const canvas = root?.querySelector<HTMLCanvasElement>('canvas');
  const hero = document.querySelector<HTMLElement>('.hero');
  if (!root || !canvas || !hero) return;

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true });
  if (!gl) return; // poster stays

  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = (n: string) => gl.getUniformLocation(prog, n);
  const u = { res: U('u_res'), cell: U('u_cell'), k: U('u_k'), origin: U('u_origin'), centre: U('u_centre'), ink: U('u_ink'), narrow: U('u_narrow'), mapb: U('u_mapb'), land: U('u_land'), infl: U('u_infl') };

  const mkTex = (unit: number) => {
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  mkTex(0);
  mkTex(1);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const infl = new Float32Array(N * N);
  const inflBytes = new Uint8Array(N * N);
  gl.activeTexture(gl.TEXTURE1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, inflBytes);
  gl.uniform1i(u.land, 0);
  gl.uniform1i(u.infl, 1);
  gl.uniform3f(u.ink, ...INK);

  let W = 1, H = 1, dpr = 1, cssW = 1, cssH = 1;
  let ready = false, visible = true, dirty = true, raf = 0;
  let pointerIn = false, tx = 0, ty = 0, sx = 0, sy = 0, lastTick = 0, lastInfl = 0, lastMove = 0;

  function resize() {
    const r = hero!.getBoundingClientRect();
    cssW = Math.max(1, r.width);
    cssH = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = Math.round(cssW * dpr);
    H = Math.round(cssH * dpr);
    canvas!.width = W;
    canvas!.height = H;
    gl!.viewport(0, 0, W, H);
    dirty = true;
    schedule();
  }

  function draw() {
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    const cell = 7 * dpr;
    const geo = heroGeo(cssW, cssH);
    gl!.uniform2f(u.res, W, H);
    gl!.uniform1f(u.cell, cell);
    gl!.uniform1f(u.k, geo.k * dpr);
    gl!.uniform1f(u.narrow, geo.narrow ? 1 : 0);
    gl!.uniform1f(u.mapb, geo.mapBottom * dpr);
    gl!.uniform2f(u.origin, geo.ox * dpr, geo.oy * dpr);
    gl!.uniform2f(u.centre, HERO_CENTRE[0], HERO_CENTRE[1]);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  // influence field, <= 30 Hz
  function tick(now: number) {
    if (now - lastTick < 33) return false;
    lastTick = now;
    let max = 0;
    for (let i = 0; i < infl.length; i++) {
      const v = infl[i] * 0.94;
      infl[i] = v < 0.004 ? 0 : v;
      if (infl[i] > max) max = infl[i];
    }
    if (pointerIn) {
      sx += (tx - sx) * 0.14;
      sy += (ty - sy) * 0.14;
      const cx = (sx / cssW) * N, cy = (sy / cssH) * N;
      const rx = (130 / cssW) * N, ry = (130 / cssH) * N;
      const x0 = Math.max(0, Math.floor(cx - rx * 2)), x1 = Math.min(N - 1, Math.ceil(cx + rx * 2));
      const y0 = Math.max(0, Math.floor(cy - ry * 2)), y1 = Math.min(N - 1, Math.ceil(cy + ry * 2));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          const g = Math.exp(-(dx * dx + dy * dy) * 1.6) * 0.18;
          const i = y * N + x;
          infl[i] = Math.min(1, infl[i] + g);
          if (infl[i] > max) max = infl[i];
        }
      }
    }
    lastInfl = max;
    for (let i = 0; i < infl.length; i++) inflBytes[i] = Math.round(infl[i] * 255);
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.texSubImage2D(gl!.TEXTURE_2D, 0, 0, 0, N, N, gl!.RED, gl!.UNSIGNED_BYTE, inflBytes);
    return true;
  }

  function frame(now: number) {
    raf = 0;
    if (!ready || !visible || document.hidden) return;
    if (pointerIn && now - lastMove > 2500) pointerIn = false; // a resting cursor stops feeding the field
    if (pointerIn || lastInfl > 0) { if (tick(now)) dirty = true; }
    if (dirty) { draw(); dirty = false; }
    if (pointerIn || lastInfl > 0) schedule();
  }
  function schedule() { if (!raf && ready && visible && !document.hidden) raf = requestAnimationFrame(frame); }

  // pointer: mouse and pen only, never on touch
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) {
    hero.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const r = hero.getBoundingClientRect();
      tx = e.clientX - r.left;
      ty = e.clientY - r.top;
      if (!pointerIn) { sx = tx; sy = ty; }
      pointerIn = true;
      lastMove = performance.now();
      schedule();
    });
    hero.addEventListener('pointerleave', () => { pointerIn = false; schedule(); });
  }

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) { dirty = true; schedule(); } }).observe(hero);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { dirty = true; schedule(); } });
  new ResizeObserver(resize).observe(hero);

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); ready = false; root.classList.remove('live'); });
  // after a lost context the poster stays: no reload, so scroll position and replay state survive

  const img = new Image();
  img.onload = () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    ready = true;
    resize();
    draw();
    dirty = false;
    root.classList.add('live');
    (window as unknown as { __heroReady?: boolean }).__heroReady = true;
  };
  img.src = '/assets/landmask.png';
}

try { boot(); } catch (err) { console.warn('hero shader disabled:', err); }
