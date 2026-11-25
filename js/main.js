// ─────────────────────────────────────────────────────────────────────────────
//  MAIN — one scroll timeline, no cuts:
//    fall into the black hole → darkness → a galaxy emerges → dive in →
//    one star becomes the Sun → Neptune … Saturn … Jupiter … Mars → Earth
// ─────────────────────────────────────────────────────────────────────────────
import { createBlackHole, smooth, LABELS, monotone } from './blackhole.js';

// Scroll pacing of the journey: [scroll fraction, journey progress].
// The galaxy dive (progress 0–0.42) is quick; the solar system gets most of the scroll.
const PACE = [[0, 0], [0.06, 0.07], [0.16, 0.29], [0.34, 0.47], [0.64, 0.75], [1, 1]];
const fToU = f => monotone(PACE, f);
function uToF(u) { let a = 0, b = 1; for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (fToU(m) < u) a = m; else b = m; } return (a + b) / 2; }

// ── EDIT YOUR CONTENT HERE ───────────────────────────────────────────────────
const SITE = {
  name: 'Vedant Bhayani',
  email: 'vedantbhayani00@gmail.com',
  role: 'Creative Developer · Web · App · Software',
};
// Each page appears at a point of the journey: [from, to] in journey progress 0..1.
// side = where the text sits (the scene is framed on the other side).
const PAGES = [
  { nav: 'About', at: [0.035, 0.20], side: 'left', kicker: 'About',
    title: 'Where ideas<br><em>are born.</em>',
    body: 'I’m Vedant, a creative developer. I design and build websites, apps and software that feel alive: fast, beautiful and made to be remembered.' },
  { nav: 'Work', at: [0.575, 0.655], side: 'right', kicker: 'Selected work',
    title: 'Things I’ve<br><em>created.</em>',
    list: [['Event Horizon', 'Website · 2026'], ['Infinity Castle Portfolio', 'Website · 2026'], ['Pocket Universe', 'App · 2026'], ['Stardust Studio', 'Software · 2026']] },
  { nav: 'Lab', at: [0.70, 0.765], side: 'left', kicker: 'Lab',
    title: 'Experiments<br><em>& craft.</em>',
    body: 'Where I experiment. What I build with:',
    list: [['Websites', 'Creative web'], ['Mobile & web apps', 'Apps'], ['Software & tools', 'Software'], ['3D · WebGL · motion', 'Interactive']] },
  { nav: 'Contact', at: [0.905, 1.01], side: 'right', kicker: 'Contact · Home',
    title: 'Every journey<br><em>ends at home.</em>',
    body: 'Have a website, app or software idea? Let’s build something that bends a little light.',
    contact: true },
];
// ─────────────────────────────────────────────────────────────────────────────

const $ = s => document.querySelector(s);
const qs = new URLSearchParams(location.search);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const quality = qs.get('q') || 'auto';
const root = document.documentElement;
const css = (k, v) => root.style.setProperty(k, v);
// Dedicated phone/tablet profile: small WebP textures, lighter rendering,
// portrait framing (planet above, text below), shorter scroll, menu sheet.
// Force with ?m=1 / ?m=0.
const MOBILE = qs.get('m') === '1' || (qs.get('m') !== '0' &&
  (matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600));
root.classList.toggle('mobile', MOBILE);

// ── auto fullscreen on the first click / tap / key press (browsers require a user gesture).
//    Runs once: if the visitor leaves fullscreen (Esc), we never force it again. Opt out with ?fs=0.
//    iPhone Safari has no fullscreen API for pages, so there it simply does nothing.
(() => {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req || qs.get('fs') === '0' || window.matchMedia('(display-mode: fullscreen)').matches) return;
  const events = ['click', 'touchend', 'keydown'];
  const go = e => {
    if (e.type === 'keydown' && (e.key === 'Escape' || e.metaKey || e.ctrlKey || e.altKey)) return;
    events.forEach(ev => removeEventListener(ev, go, true));
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    try {
      const r = req.call(el, { navigationUI: 'hide' });
      if (r && r.catch) r.catch(() => {});          // denied / unsupported → stay windowed, no error
    } catch (_) {}
  };
  events.forEach(ev => addEventListener(ev, go, { capture: true, passive: true }));
})();

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
scrollTo(0, 0);

// ── build DOM
document.querySelectorAll('[data-name]').forEach(el => el.textContent = SITE.name);
document.querySelectorAll('[data-role]').forEach(el => el.textContent = SITE.role);
document.querySelectorAll('[data-name-lines]').forEach(el => el.innerHTML = SITE.name.split(' ').map(w => `<span>${w}</span>`).join(' '));
document.title = `${SITE.name} — Creative Developer`;
const pagesEl = $('#pages');
const panels = PAGES.map(pg => {
  const el = document.createElement('article');
  el.className = 'panel' + (pg.side === 'right' ? ' right' : '');
  el.id = pg.nav.toLowerCase();
  const list = pg.list ? `<ul>${pg.list.map(([a, b]) => `<li>${a}<span>${b}</span></li>`).join('')}</ul>` : '';
  const contact = pg.contact
    ? `<a class="mail" href="mailto:${SITE.email}">${SITE.email}</a><p class="foot">${SITE.name} · © ${new Date().getFullYear()}</p>
       <p class="credit">Planet &amp; Milky Way imagery: <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener">Solar System Scope</a>, CC BY 4.0</p>` : '';
  el.innerHTML = `<p class="kicker">${pg.kicker}</p><h2>${pg.title}</h2>${pg.body ? `<p class="body">${pg.body}</p>` : ''}${list}${contact}`;
  pagesEl.appendChild(el);
  return el;
});
const nav = $('#nav');
nav.innerHTML = PAGES.map((pg, i) => `<a href="#${pg.nav.toLowerCase()}" data-i="${i}">${pg.nav}</a>`).join('');
const navLinks = [...nav.querySelectorAll('a')];
const menuBtn = $('#menuBtn');
menuBtn.addEventListener('click', () => root.classList.toggle('menu-open'));
navLinks.forEach(a => a.addEventListener('click', () => root.classList.remove('menu-open')));

const loader = $('#loader'), canvas = $('#bh');
const hudDist = $('#hudDist'), hudTime = $('#hudTime'), hudBar = $('#hudBar');
const btName = $('#btName'), btInfo = $('#btInfo');
const holeSec = $('#hole'), journeySec = $('#journey');

// ── idle scroll cue (right side): fades in when you stop, vanishes when you scroll.
//    At the very end it turns into "Back to top".
const cue = document.createElement('button');
cue.className = 'scrollcue'; cue.type = 'button'; cue.setAttribute('aria-label', 'Scroll');
cue.innerHTML = '<span class="sc-txt"><b class="sc-down">Scroll</b><b class="sc-up">Back to top</b></span>'
  + '<span class="sc-track"><i></i></span>'
  + '<svg class="sc-arrow" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
cue.addEventListener('click', () => {
  if (cue.classList.contains('at-end')) scrollTo({ top: 0, behavior: 'smooth' });
  else scrollBy({ top: innerHeight * 0.9, behavior: 'smooth' });
});
document.body.appendChild(cue);
let lastScrollAt = performance.now(), cueShown = false, cueTop = false;
const markScroll = () => { lastScrollAt = performance.now(); };
['scroll', 'wheel', 'touchmove', 'keydown'].forEach(ev => addEventListener(ev, markScroll, { passive: true }));

// ── layout cache (never read layout inside the frame loop)
let L = {};
function measure() {
  L = {
    hole: { top: holeSec.offsetTop, len: Math.max(1, holeSec.offsetHeight - innerHeight) },
    // the journey starts the moment the fall ends, so the black frames line up exactly
    jTop: holeSec.offsetTop + holeSec.offsetHeight - innerHeight,
    jLen: Math.max(1, journeySec.offsetHeight),
    max: Math.max(1, document.documentElement.scrollHeight - innerHeight), vh: innerHeight,
  };
}
measure();

// ── critically-damped spring on scroll position (px)
const spring = { x: 0, v: 0, w: reducedMotion ? 14 : 6.5 };
function stepSpring(target, dt) {
  const n = Math.ceil(dt / (1 / 120)), h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = spring.w * spring.w * (target - spring.x) - 2 * spring.w * spring.v;
    spring.v += a * h; spring.x += spring.v * h;
  }
  if (Math.abs(target - spring.x) < 0.05 && Math.abs(spring.v) < 0.05) { spring.x = target; spring.v = 0; }
}

const ptr = { tx: 0, ty: 0, x: 0, y: 0 };
addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  ptr.tx = (e.clientX / innerWidth) * 2 - 1; ptr.ty = (e.clientY / innerHeight) * 2 - 1;
}, { passive: true });
document.addEventListener('mouseleave', () => { ptr.tx = 0; ptr.ty = 0; });

const uToY = u => L.jTop + uToF(u) * L.jLen;
navLinks.forEach((a, i) => a.addEventListener('click', e => {
  e.preventDefault();
  const [a0, a1] = PAGES[i].at;
  scrollTo({ top: uToY(Math.min(1, (a0 + Math.min(a1, 1)) / 2)), behavior: 'smooth' });
}));
$('.brand').addEventListener('click', e => { e.preventDefault(); scrollTo({ top: 0, behavior: 'smooth' }); });

// ── smoothed scroll → scene + UI
const clamp01 = x => Math.min(1, Math.max(0, x));
function sceneAt(y) {
  if (y < L.jTop) {
    const p = clamp01((y - L.hole.top) / L.hole.len);
    return { s: { mode: 'hole', p }, ui: {
      title: 1 - smooth(0, 0.07, p), hud: smooth(0.03, 0.1, p) * (1 - smooth(0.975, 0.995, p)), u: -1 } };
  }
  const u = fToU(clamp01((y - L.jTop) / L.jLen));
  // darkness inside the horizon, then the galaxy slowly appears — no flash
  return { s: { mode: 'space', u, fade: smooth(0.004, 0.05, u) }, ui: { title: 0, hud: 0, u } };
}

// ── boot
let engine = null;
// loader: 0–60% = shaders compiling, 60–100% = landing sky + Moon photos
const ldPct = $('#ldPct');
let loadShown = 0;
const setLoad = p => {
  loadShown = Math.max(loadShown, Math.min(1, p));
  css('--load', loadShown.toFixed(3));
  if (ldPct) ldPct.textContent = String(Math.round(loadShown * 100)).padStart(2, '0');
};
setLoad(0.06);
let fakeT = setInterval(() => setLoad(loadShown + (0.55 - loadShown) * 0.08), 120);   // eases toward 55% while compiling
(async () => {
  try {
    engine = await createBlackHole(canvas, {
      mobile: MOBILE,
      maxDpr: quality === 'high' ? 2 : quality === 'low' ? 1 : MOBILE ? 1.25 : 1.5,
      maxPixels: quality === 'high' ? 5e6 : MOBILE ? 1.0e6 : 3.2e6,
      steps: quality === 'low' ? 150 : quality === 'high' ? 300 : MOBILE ? 150 : 220,
      reducedMotion,
      onProgress: (f, key) => { if (key === 'tPano' || key === 'tMoon') setLoad(0.6 + 0.2 * ((engine?.hasPano() ? 1 : 0) + (key === 'tMoon' ? 1 : 0))); },
    });
  } catch (e) {
    console.error(e);
    root.classList.add('no-gl');
    $('#glError').textContent = e.message;
    setLoad(1); finish(); return;
  }
  clearInterval(fakeT);
  if (qs.has('debug')) window.__bh = engine;
  setLoad(0.6);
  for (let i = 0; i < 3; i++) engine.render(1 / 60, { mode: 'hole', p: 0 });
  engine.gl.finish();
  engine.spaceReady.then(() => { warmSpace = true; }).catch(e => console.error(e));
  // reveal once the real sky has arrived (or after 3.5 s at most, so nothing ever hangs)
  const t0 = performance.now();
  (function waitSky() {
    if (engine.hasPano() || performance.now() - t0 > 3500) {
      engine.render(1 / 60, { mode: 'hole', p: 0 }); engine.render(1 / 60, { mode: 'hole', p: 0 });
      setLoad(1); setTimeout(finish, 350); requestAnimationFrame(loop);
    } else { engine.render(1 / 60, { mode: 'hole', p: 0 }); setTimeout(waitSky, 50); }
  })();
})();
function finish() { clearInterval(fakeT); loader.classList.add('done'); root.classList.add('ready'); }

// ── frame loop
let warmSpace = false;
let last = performance.now(), running = true, hudT = 0, shownPage = -2, shownLabel = '';
function loop(now) {
  if (!running) return;
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
  stepSpring(scrollY, dt);
  const k = 1 - Math.exp(-dt * 4);
  ptr.x += (ptr.tx - ptr.x) * k; ptr.y += (ptr.ty - ptr.y) * k;

  if (warmSpace) { warmSpace = false; engine.render(0, { mode: 'space', u: 0.5, fade: 1 }); }  // prime the GPU pipeline
  const { s, ui } = sceneAt(spring.x);
  s.velocity = spring.v / L.vh; s.pointer = MOBILE ? [0, 0] : [ptr.x, ptr.y];   // no mouse look-around on phones
  const out = engine.render(dt, s);
  engine.adapt(dt);

  hudT += dt;
  if (hudT > 0.066 && s.mode === 'hole') {
    hudT = 0;
    hudDist.textContent = out.distance.toFixed(2);
    hudTime.textContent = out.inside ? '0 · inside' : out.dilation.toFixed(4);
  }
  css('--title', ui.title.toFixed(3)); css('--hud', ui.hud.toFixed(3));

  // pages + labels
  let active = -1;
  panels.forEach((el, i) => {
    const [a0, a1] = PAGES[i].at;
    const o = ui.u < 0 ? 0 : smooth(a0, a0 + 0.02, ui.u) * (1 - smooth(a1 - 0.015, a1, ui.u));
    el.style.setProperty('--o', o.toFixed(3));
    el.classList.toggle('live', o > 0.5);
    if (o > 0.5) active = i;
  });
  if (active !== shownPage) { shownPage = active; navLinks.forEach((a, i) => a.classList.toggle('on', i === active)); }
  let lab = null, bt = 0;
  if (ui.u >= 0) for (const l of LABELS) if (ui.u >= l[0] && ui.u < l[1]) {
    lab = l; bt = smooth(l[0], l[0] + 0.008, ui.u) * (1 - smooth(l[1] - 0.008, l[1], ui.u)); break;
  }
  if (lab && lab[2] !== shownLabel) { shownLabel = lab[2]; btName.textContent = lab[2]; btInfo.textContent = lab[3]; }
  css('--bt', (bt * (active >= 0 ? 0.6 : 1)).toFixed(3));
  // scroll cue: only after ~1.2 s of stillness, never on the landing (it has its own hint) or with the menu open
  const atEnd = scrollY >= L.max - 4;
  const cueOn = performance.now() - lastScrollAt > 1200 && Math.abs(spring.v) < 2 && root.classList.contains('ready')
    && ui.title < 0.05 && !root.classList.contains('menu-open');
  if (cueOn !== cueShown) { cueShown = cueOn; cue.classList.toggle('on', cueOn); }
  if (atEnd !== cueTop) { cueTop = atEnd; cue.classList.toggle('at-end', atEnd); cue.setAttribute('aria-label', atEnd ? 'Back to top' : 'Scroll'); }
  hudBar.style.transform = `scaleY(${clamp01(spring.x / L.max).toFixed(4)})`;
  requestAnimationFrame(loop);
}

// ── lifecycle
document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
  if (running && engine) { last = performance.now(); requestAnimationFrame(loop); }
});
let rzT;
new ResizeObserver(() => {
  clearTimeout(rzT);
  rzT = setTimeout(() => { measure(); engine?.resize(); }, 120);
}).observe(document.body);
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); running = false; });
canvas.addEventListener('webglcontextrestored', () => location.reload());

// debug: ?u=0.6 jumps to that point of the journey, ?at=0.5 to a fraction of the page
if (qs.has('u') || qs.has('at')) {
  requestAnimationFrame(() => {
    measure();
    const y = qs.has('u') ? uToY(+qs.get('u')) : +qs.get('at') * L.max;
    scrollTo(0, y); spring.x = y;
  });
}
