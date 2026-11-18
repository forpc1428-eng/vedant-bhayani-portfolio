# Vedant Bhayani — Portfolio

A scroll journey through space

One continuous flight, no cuts: fall into a black hole → darkness → a spiral galaxy
emerges → dive into it → one star becomes the Sun → Neptune, Uranus, Saturn (Work),
Jupiter (Lab), the asteroid belt, Mars → Earth (Contact). Pure WebGL2, no libraries.

## Deploy (Vercel)
Import this repo in Vercel → Framework preset **Other**, no build command, output directory = repo root. `vercel.json` sets long-cache headers for textures and fonts.

## Mobile
Phones/tablets get a dedicated profile automatically: 1.2 MB WebP textures (`textures/m`), lighter rendering, portrait framing (planet above, text in a bottom sheet), a menu sheet and shorter scroll. Force it with `?m=1` (or `?m=0` for desktop).

## Run locally
Double-click `start.bat` → http://localhost:8090 (or `py -m http.server 8090` in this folder).
Debug: `?u=0.6` jumps to a point of the journey (0 = just past the horizon, 1 = Earth), `?q=low|high`.

## Edit
| What | Where |
|---|---|
| Name, email, page text, projects, where each page appears | `js/main.js` → `SITE`, `PAGES` |
| Black hole fall | `js/blackhole.js` → `FLIGHT` |
| Planet layout / camera stops along the journey | `js/blackhole.js` → `BODIES`, `SYS_KEYS`, `LABELS` |
| Length of the fall / journey | `css/style.css` → `#hole`, `#journey` heights |

## Realism
- Planets, the Moon, the Sun, Saturn's rings and the Milky Way sky use real imagery in
  `textures/` from **Solar System Scope** (https://www.solarsystemscope.com/textures/),
  licensed **CC BY 4.0** — keep the credit line on the Contact page.
- Earth: day map, night city lights, moving cloud layer with cloud shadows, ocean sun-glint, atmosphere.
- Mercury, Mars, the Moon: surface relief derived from the photos, so craters catch the light.
- The galaxy dive is a 3D volume with a 3D star field (real parallax); it hands over to the
  real Milky Way panorama as you enter the disk.

## Performance
Textures (desktop ~6 MB, phones ~1.2 MB, WebP) stream in while you are on the landing page and upload one per frame.
Shader loops use a `uZero` uniform so the Windows compiler can't unroll them (fast load).
Dynamic resolution + temporal anti-aliasing keep the frame rate up.
