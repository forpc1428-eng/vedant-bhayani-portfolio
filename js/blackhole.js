// ─────────────────────────────────────────────────────────────────────────────
//  EVENT HORIZON ENGINE  ·  pure WebGL2, zero dependencies
//
//  Two scene shaders share one post pipeline:
//   • HOLE   Schwarzschild raymarch: accretion disk + a lensed sky (stars,
//            nebulae, galaxies, a moon, shooting stars).
//   • SPACE  one continuous universe past the horizon: a volumetric spiral
//            galaxy, a 3D star field with real parallax, and a full solar
//            system (Sun, 8 planets, the Moon, Saturn's and Uranus' rings,
//            the asteroid belt). Two coordinate frames (galaxy / system) share
//            one camera, so zooming from galaxy scale to planet scale is seamless.
//  Then: TAA → upscale → 6-level bloom → grade (ACES, grain, fade).
// ─────────────────────────────────────────────────────────────────────────────

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = x => Math.min(1, Math.max(0, x));
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const mul = (a, s) => [a[0]*s, a[1]*s, a[2]*s];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
const vlerp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const D2R = Math.PI / 180;

// ═════════════════════════════════════════════════════════════════════════════
//  1 · THE FALL (black hole)
// ═════════════════════════════════════════════════════════════════════════════
export const FLIGHT = {
  // [scroll progress, distance in Schwarzschild radii]; < 1 = inside the horizon
  dist: [[0, 64], [0.3, 40], [0.55, 21], [0.74, 10], [0.86, 5.2], [0.95, 2.7], [0.985, 1.4], [1, 0.95]],
  fov:  [[0, 36], [0.55, 42], [0.8, 56], [0.95, 84], [1, 100]],
  elev0: 12, elev1: 18, az0: 16, az1: -10, roll0: -0.09, roll1: 0.10, lift: 0.10,
};

// ═════════════════════════════════════════════════════════════════════════════
//  2 · THE UNIVERSE (galaxy → Sun → planets)
// ═════════════════════════════════════════════════════════════════════════════
//  Galaxy frame: galaxy centre at origin, disk in XZ, radius ~110 units.
//  System frame: Sun at origin, ecliptic in XZ.  1 galaxy unit = K system units.
const K = 1e5;
const PSUN = [54, 0, 12];                      // where our Sun sits in the galaxy
const DEND = norm([0.05, 0.12, 1]);            // direction we arrive at the Sun from

// Planets (system units; distances and sizes compressed so they fit one flight).
// [name, distance, angle (rad, around the Sun from +z), radius, real distance label]
export const BODIES = [
  ['Mercury', 4.0, -0.90, 0.14, '0.39 AU'],
  ['Venus',   5.6,  0.75, 0.30, '0.72 AU'],
  ['Earth',   7.6, -0.25, 0.32, '1.00 AU'],
  ['Mars',   10.5,  0.30, 0.20, '1.52 AU'],
  ['Jupiter',17.0, -0.28, 1.25, '5.20 AU'],
  ['Saturn', 25.0,  0.22, 1.05, '9.58 AU'],
  ['Uranus', 33.0, -0.18, 0.62, '19.2 AU'],
  ['Neptune',41.0,  0.15, 0.60, '30.1 AU'],
];
const PL = BODIES.map(([, d, a, r]) => ({ p: [d * Math.sin(a), 0, d * Math.cos(a)], r }));
const EARTH = PL[2].p;
PL.push({ p: add(EARTH, [0.78, 0.10, 0.30]), r: 0.085 });          // the Moon (index 8), moved every frame
// Moon orbit around Earth: radius, slight tilt, one lap every ~70 s
function moonPos(t) {
  const a = 0.6 + t * 0.09, r = 0.85;
  return add(EARTH, [Math.cos(a) * r, Math.sin(a) * r * 0.09, Math.sin(a) * r]);
}
const PL_UNIFORM = new Float32Array(PL.flatMap(b => [...b.p, b.r]));

// distance from the Sun during the galaxy approach (galaxy units, log-interpolated)
const DG = [[0, 240], [0.08, 205], [0.16, 150], [0.24, 70], [0.28, 18], [0.315, 3.5], [0.35, 0.5],
            [0.38, 0.05], [0.40, 0.008], [0.42, 0.0016]].map(([u, d]) => [u, Math.log(d)]);
export const U_HAND = 0.42;                     // galaxy frame → system frame

// Camera beside a planet. The Sun lights it from the side (like real spacecraft
// photos: a sharp day/night line gives the sphere its depth).
// Desktop: planet left (shift>0) or right (shift<0) of the text.
// Mobile (portrait): planet in the upper part of the screen, text below.
let MOBILE = false;
function visit(i, side, distMul, shift, lift = 0.22) {
  const P = PL[i].p, R = PL[i].r;
  // visible size including rings, so Saturn / Uranus fit on a narrow portrait screen
  const RV = i === 5 ? R * 2.35 : i === 6 ? R * 1.8 : R;
  const dist = MOBILE ? Math.max(R * distMul * 1.25, RV * 7.6) : R * distMul;
  const fwd = norm(mul(P, -1)), up = [0, 1, 0], right = norm(cross(fwd, up));
  // desktop: side-lit (dramatic day/night line); phones: mostly lit so the whole disc reads on a small screen
  const sunward = MOBILE ? 0.75 : 0.16, across = MOBILE ? 0.6 : 0.85;
  const eye = add(P, add(mul(right, side * dist * across), add(mul(fwd, dist * sunward), mul(up, dist * lift))));
  const view = norm(sub(P, eye)), camR = norm(cross(view, up)), camU = cross(camR, view);
  // phones aim straight at the planet; the whole view is tilted in render() so it sits above the text
  const target = MOBILE ? P : add(P, mul(camR, shift * R));
  return { eye, target };
}
const V = (u, v, hold = false) => ({ u, eye: v.eye, target: v.target, hold });
// The whole solar-system leg as one spline. Close pairs of keys = gentle slow-downs
// where a page is shown (speed never reaches zero, so motion never "stops").
let SYS_KEYS = [];
export function setLayout(mobile) {
  MOBILE = !!mobile;
  SYS_KEYS = [
    { u: U_HAND, eye: mul(DEND, 160), target: [0, 0, 0] },
    { u: 0.44,   eye: add(mul(DEND, 95), [3, 1, 0]), target: vlerp([0, 0, 0], PL[7].p, 0.6) },
    V(0.475, visit(7, 1, 6.5, -0.6)),                         // Neptune
    V(0.52,  visit(6, -1, 6.5, 0.6)),                         // Uranus
    V(0.575, visit(5, 1, 5.6, 1.6), true),                    // Saturn  (Work)
    V(0.645, visit(5, 1, 5.0, 1.7, 0.3), true),
    V(0.70,  visit(4, -1, 4.9, -1.6), true),                  // Jupiter (Lab)
    V(0.755, visit(4, -1, 4.4, -1.7, 0.3), true),
    { u: 0.80, eye: [3.2, 0.55, 13.4], target: PL[3].p },     // asteroid belt
    V(0.845, visit(3, 1, 7.5, -0.5)),                         // Mars
    V(0.905, visit(2, 1, 7.4, 1.7), true),                    // Earth   (Contact)
    V(1.0,   visit(2, 1, 6.2, 1.8, 0.3), true),
  ];
}
setLayout(false);

// labels shown while passing each body: [u from, u to, name, detail]
export const LABELS = [
  [0.02, 0.33, 'Spiral galaxy', '100 000 light-years across'],
  [0.33, 0.44, 'The Sun', 'G-type star · 4.6 billion years'],
  [0.455, 0.50, 'Neptune', '30.1 AU'], [0.50, 0.55, 'Uranus', '19.2 AU'],
  [0.55, 0.675, 'Saturn', '9.58 AU'], [0.675, 0.78, 'Jupiter', '5.20 AU'],
  [0.78, 0.825, 'Asteroid belt', '2.2 – 3.2 AU'], [0.825, 0.875, 'Mars', '1.52 AU'],
  [0.875, 1.01, 'Earth', '1.00 AU'],
];

// ═════════════════════════════════════════════════════════════════════════════
//  SHADERS
// ═════════════════════════════════════════════════════════════════════════════
const VS_FS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;

const COMMON = `
uniform int uZero;   // always 0: stops the D3D compiler unrolling loops (7s+ link times)
float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i),               hash13(i+vec3(1,0,0)),f.x),
                 mix(hash13(i+vec3(0,1,0)),   hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),   hash13(i+vec3(1,0,1)),f.x),
                 mix(hash13(i+vec3(0,1,1)),   hash13(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm4(vec3 p){ float a=0.5,s=0.0; for(int i=uZero;i<4;i++){ s+=a*vnoise(p); p=p*2.07+vec3(1.7,9.2,3.1); a*=0.5; } return s/0.9375; }
float fbm5(vec3 p){ float a=0.5,s=0.0; for(int i=uZero;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec3(4.1,1.3,7.7); a*=0.5; } return s/0.96875; }
float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(0.06711056,0.00583715)))); }
vec3 blackbody(float t){
  t = clamp(t, 1000.0, 40000.0)/100.0;
  vec3 c;
  c.r = t<=66.0 ? 1.0 : clamp(1.29293618606*pow(max(t-60.0,1.0),-0.1332047592),0.0,1.0);
  c.g = t<=66.0 ? clamp(0.39008157876*log(t)-0.63184144378,0.0,1.0)
                : clamp(1.12989086089*pow(max(t-60.0,1.0),-0.0755148492),0.0,1.0);
  c.b = t>=66.0 ? 1.0 : (t<=19.0 ? 0.0 : clamp(0.54320678911*log(max(t-10.0,1.0))-1.19625408914,0.0,1.0));
  return c*c;
}
float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
// equirectangular lookup for a unit direction (planet maps, sky panorama)
vec2 eqUV(vec3 n){ return vec2(0.5 + atan(n.z, n.x)*0.15915494, 0.5 - asin(clamp(n.y,-1.0,1.0))*0.31830989); }
vec3 starLayer(vec3 d, float scale, float density, float pixAng, float seed){
  vec3 p = d*scale; vec3 id = floor(p); vec3 f = fract(p)-0.5;
  float h = hash13(id+seed);
  if(h < 1.0-density) return vec3(0.0);
  vec3 o = (vec3(hash13(id+1.3+seed),hash13(id+7.1+seed),hash13(id+4.7+seed))-0.5)*0.6;
  float dd = length(f-o);
  float sz = max(pixAng*scale*0.7, 0.012);
  float mag = pow(hash13(id+9.9+seed), 7.0)*7.0 + 0.2;
  float b = exp(-dd*dd/(sz*sz)) * mag * min(1.0, (0.02/sz)*(0.02/sz));
  return blackbody(mix(2800.0, 12000.0, pow(hash13(id+3.3+seed),0.8))) * b;
}
const float SL_SCALE[4] = float[4](70.0, 160.0, 340.0, 700.0);
const float SL_DENS[4]  = float[4](0.012, 0.014, 0.016, 0.014);
const float SL_BAND[4]  = float[4](0.0, 0.020, 0.045, 0.07);
const float SL_GAIN[4]  = float[4](1.0, 0.8, 0.55, 0.35);
vec3 stars(vec3 d, float pixAng, float dens, float band){
  vec3 c = vec3(0.0);
  for(int i=uZero;i<4;i++)
    c += starLayer(d, SL_SCALE[i], SL_DENS[i]*dens + SL_BAND[i]*band, pixAng, float(i)*23.7)*SL_GAIN[i];
  return c;
}
vec3 nebula(vec3 d, vec3 cA, vec3 cB, vec3 cC, float amt, float seed){
  vec3 q = d*1.7 + seed;
  float w = fbm4(q*1.4 + 5.2);
  float n = fbm5(q + w*1.6);
  float m = fbm4(q*2.6 - w*1.2 + 3.0);
  float dens = smoothstep(0.40, 0.88, n);
  vec3 gas = mix(cA, cB, smoothstep(0.32,0.72,m));
  gas = mix(gas, cC, smoothstep(0.62,0.92,w)*0.6);
  float dust = smoothstep(0.48, 0.74, fbm4(q*4.2 + 11.0));
  return gas*dens*dens*amt*(1.0 - 0.75*dust);
}
float sph(vec3 ro, vec3 rd, vec3 c, float r){
  vec3 oc = ro-c; float b = dot(oc,rd); float h = b*b - dot(oc,oc) + r*r;
  if(h < 0.0) return -1.0; return -b - sqrt(h);
}
`;

// ── HOLE ─────────────────────────────────────────────────────────────────────
const FS_BH = `#version 300 es
precision highp float;
out vec4 frag;
uniform vec2  uRes, uJitter;
uniform float uTan, uFrame, uDiskT, uBeam, uFar, uInside, uTime;
uniform vec3  uEye, uCX, uCY, uCZ;
uniform int   uSteps;
uniform vec3  SF, SR, SU;          // basis of the opening view: places the moon & meteors
uniform samplerCube uSky;          // baked nebulae + galaxies (rgb) and dust (a)
uniform sampler2D tPano;           // real Milky Way panorama (photo)
uniform float uPano;               // 1 once the panorama is loaded
uniform mat3 uSkyRot;              // orients the panorama's galactic band
uniform sampler2D tMoonH;          // real Moon photo
uniform float uMoonTex, uMoonW;
${COMMON}
const float M = 0.5, RIN = 2.6, ROUT = 15.0;
const vec3 BAND_N = vec3(0.3328, 0.8875, -0.3189);

float diskPattern(float r, float ang){
  float omega = 2.0*pow(r,-1.5);
  const float P = 9.0;
  float t1 = fract(uDiskT/P), t2 = fract(uDiskT/P + 0.5);
  float w1 = 1.0 - abs(2.0*t1 - 1.0), w2 = 1.0 - w1;
  float lr = log(r);
  float a1 = ang - omega*t1*P, a2 = ang - omega*t2*P;
  vec3 q1 = vec3(cos(a1)*2.6, sin(a1)*2.6, lr*9.0);
  vec3 q2 = vec3(cos(a2)*2.6, sin(a2)*2.6, lr*9.0 + 17.3);
  float n1 = fbm4(q1 + vec3(0.0,0.0,vnoise(q1*0.7)*0.9));
  float n2 = fbm4(q2 + vec3(0.0,0.0,vnoise(q2*0.7)*0.9));
  float n  = ((n1-0.5)*w1 + (n2-0.5)*w2) / sqrt(w1*w1 + w2*w2);
  n += (vnoise(q1*5.0) - 0.5)*0.22*w1 + (vnoise(q2*5.0) - 0.5)*0.22*w2;   // fine turbulence
  float lanes = 0.5 + 0.5*sin(lr*58.0 + n*6.0);
  return clamp(0.5 + n*1.2, 0.0, 1.0) * (0.86 + 0.14*lanes);
}
vec4 disk(vec3 p, vec3 dir){
  float r = length(p.xz);
  if(r < RIN*0.82 || r > ROUT) return vec4(0.0);
  float n = diskPattern(r, atan(p.z, p.x));
  float x = r/RIN;
  float prof = pow(x,-0.75)*pow(max(1.0-inversesqrt(x),0.0),0.25)/0.488;
  float inner = smoothstep(RIN*0.82, RIN*1.12, r);
  float outer = 1.0 - smoothstep(ROUT*0.38, ROUT, r);
  float beta = min(sqrt(M/max(r-2.0*M,0.05)), 0.72);
  float gam  = inversesqrt(1.0-beta*beta);
  vec3  vhat = normalize(vec3(-p.z, 0.0, p.x));
  float g = sqrt(max(1.0-2.0*M/r, 0.01)) / (gam*(1.0 - beta*dot(vhat, -dir)));
  g = mix(1.0, g, uBeam);
  vec3  col = blackbody(4500.0*max(prof,0.22)*g);
  float I   = (0.05 + pow(prof,1.5)) * pow(g,3.0) * (0.25 + 1.6*n*n);
  float a   = clamp(inner*outer*(0.12 + 1.35*n)*mix(1.0,0.55,smoothstep(0.3,1.0,r/ROUT)), 0.0, 1.0);
  return vec4(col*I*2.6*inner*outer, a);
}

vec4 moon(vec3 d, float pixAng){
  vec3 c = normalize(SF + SR*0.21 + SU*0.14);
  const float R = 0.034;
  if(dot(d, c) < cos(R*4.0)) return vec4(0.0);
  vec3 u = normalize(cross(SU, c)); vec3 v = cross(c, u);
  vec2 q = vec2(dot(d,u), dot(d,v))/R;
  float rr = length(q);
  vec3 col = vec3(0.55,0.65,0.85)*exp(-max(rr-1.0,0.0)*2.5)*0.015*step(1.0, rr);
  float aa = max(pixAng/R*1.2, 0.01);
  float cov = smoothstep(1.0+aa, 1.0-aa, rr);
  if(cov > 0.0){
    vec3 N = vec3(q, sqrt(max(1.0-rr*rr, 0.0)));
    vec3 L = normalize(vec3(-0.75, 0.30, 0.45));
    float diff = smoothstep(-0.05, 0.25, dot(N, L)) * max(dot(N,L),0.0);
    vec3 albc;
    if(uMoonTex > 0.5){
      vec3 nm = vec3(N.z, N.y, -N.x);                      // near side faces us
      float lod = log2(max((uMoonW*0.5)/(2.0*R/pixAng), 1.0));
      vec2 muv = eqUV(nm);
      albc = textureLod(tMoonH, muv, lod).rgb*1.25;
      // relief from the photo so the craters along the terminator catch the light
      float e = max(exp2(lod), 1.0)/uMoonW;
      float h0 = luma(albc), hx = luma(textureLod(tMoonH, muv + vec2(e, 0.0), lod).rgb*1.25), hy = luma(textureLod(tMoonH, muv + vec2(0.0, e), lod).rgb*1.25);
      vec3 east = normalize(vec3(-nm.z, 0.0, nm.x)); east = vec3(-east.z, east.y, east.x);
      vec3 north = normalize(cross(east, N));
      vec3 Nb = normalize(N - (east*(hx - h0) - north*(hy - h0))*5.0);
      diff = max(dot(Nb, L), 0.0)*smoothstep(-0.1, 0.1, dot(N, L));
    } else {
      float alb = 0.62 + 0.25*fbm4(N*3.0);
      alb *= 1.0 - 0.38*smoothstep(0.45, 0.68, fbm4(N*1.4 + 4.0));
      albc = vec3(alb);
    }
    col = mix(col, vec3(1.0,0.97,0.93)*albc*diff*0.95 + vec3(0.012,0.014,0.02)*albc, cov);
  }
  return vec4(col, cov);
}

vec3 meteors(vec3 d, float pixAng){
  vec3 acc = vec3(0.0);
  for(int m=uZero; m<3; m++){
    float fm = float(m);
    float per = 8.5 + fm*3.7;
    float tt = uTime + fm*2.9;
    float cyc = floor(tt/per), ph = tt - cyc*per;
    const float LIFE = 1.1;
    if(ph > LIFE) continue;
    vec3 h = vec3(hash13(vec3(cyc,fm,1.0)), hash13(vec3(cyc,fm,2.0)), hash13(vec3(cyc,fm,3.0)));
    float side = h.x < 0.5 ? -1.0 : 1.0;      // keep clear of the hole (it would lens into a ring)
    vec3 c0 = normalize(SF + SR*side*(0.36 + fract(h.x*2.0)*0.34) + SU*(h.y*0.28 + 0.04));
    if(dot(d, c0) < 0.9) continue;
    vec2 pd = vec2(dot(d-c0, SR), dot(d-c0, SU));
    float ang = side > 0.0 ? -0.35 - h.z*0.9 : 3.1416 + 0.35 + h.z*0.9;
    vec2 hd = vec2(cos(ang), sin(ang));
    vec2 head = hd*ph*0.42;
    vec2 tail = head - hd*0.16*min(ph*4.0, 1.0);
    vec2 ab = head - tail; float t = clamp(dot(pd - tail, ab)/max(dot(ab,ab),1e-6), 0.0, 1.0);
    float dist = length(pd - (tail + ab*t));
    float w = max(pixAng*0.9, 0.0007);
    float life = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(LIFE*0.6, LIFE, ph));
    float hd2 = dot(pd-head, pd-head);
    acc += (vec3(0.85,0.9,1.0)*exp(-dist*dist/(w*w))*t*t*1.1 + vec3(1.0,0.88,0.7)*exp(-hd2/(w*w*6.0))*1.4) * life;
  }
  return acc;
}

vec3 universe(vec3 d, float pixAng){
  float bd = dot(d, BAND_N);
  float band = exp(-bd*bd*9.0);
  vec4 sk = texture(uSky, d);
  vec3 c;
  if(uPano > 0.5){
    vec3 pano = textureLod(tPano, eqUV(uSkyRot*d), 0.0).rgb;
    c = pano*1.1 + sk.rgb*0.35 + stars(d, pixAng, 0.25, 0.0)*0.6;
  } else {
    c = stars(d, pixAng, 1.25, band)*1.2*(1.0 - 0.65*sk.a) + sk.rgb;
  }
  return c + meteors(d, pixAng);
}

void main(){
  if(uInside > 0.5){ frag = vec4(0.0,0.0,0.0,1.0); return; }
  vec2 fc = gl_FragCoord.xy + uJitter;
  vec2 uv = (fc*2.0 - uRes)/uRes.y;
  vec3 vel = normalize(uCX*uv.x*uTan + uCY*uv.y*uTan - uCZ);
  vec3 pos = uEye;
  float pixAng = 2.0*uTan/uRes.y;
  vec3  hv = cross(pos, vel);
  float h2 = dot(hv, hv);
  float r  = length(pos);
  vec3  acc = -1.5*h2*pos/(r*r*r*r*r);
  vec3 col = vec3(0.0); float A = 0.0; bool hole = false;
  float jit = 0.5 + ign(gl_FragCoord.xy + uFrame*5.588238);
  for(int i=uZero;i<400;i++){
    if(i>=uSteps) break;
    float dt = clamp(0.075*r, 0.008, 2.6) * (i==0 ? jit : 1.0);
    vec3 np = pos + vel*dt + 0.5*acc*dt*dt;
    float nr = length(np);
    vec3 nacc = -1.5*h2*np/(nr*nr*nr*nr*nr);
    vec3 nvel = vel + 0.5*(acc+nacc)*dt;
    if(pos.y*np.y < 0.0){
      float k = pos.y/(pos.y-np.y);
      vec4 d = disk(mix(pos,np,k), normalize(mix(vel,nvel,k)));
      col += (1.0-A)*d.rgb*d.a;  A += (1.0-A)*d.a;
      if(A > 0.995) break;
    }
    pos = np; vel = nvel; acc = nacc; r = nr;
    if(r < 1.0){ hole = true; break; }
    if(r > uFar && dot(pos,vel) > 0.0) break;
  }
  vec3 bg = hole ? vec3(0.0) : universe(normalize(vel), pixAng);
  frag = vec4(max(col + bg*(1.0-A), 0.0), 1.0);
}`;

const GALAXY = `
const vec3 PSUN = vec3(${PSUN.join(',')});
// ── galaxy model (galaxy frame) ───────────────────────────────
float starDensity(vec3 p){
  float r = length(p.xz);
  return exp(-r/26.0)*exp(-abs(p.y)/1.0) + 2.5*exp(-length(p*vec3(1.0,1.9,1.0))/4.5);
}
void galaxyAt(vec3 p, out vec3 em, out float ext){
  float r = length(p.xz), ay = abs(p.y);
  float a = atan(p.z, p.x);
  // flocculent structure: the spiral phase is warped by turbulence at two scales
  float nL = vnoise(p*0.085 + 19.0);                               // galaxy-scale turbulence
  float n  = vnoise(p*0.42)*0.6 + vnoise(p*1.7 + 7.0)*0.4;
  float nf = vnoise(p*1.7 + 3.0);                                  // star-forming clumps (visible from afar)
  // arms wander, branch and break into segments instead of two perfect bands
  float ph = 2.0*a - log(max(r, 0.6))*7.0 + (nL - 0.5)*2.8 + (n - 0.5)*1.3;
  float seg = 0.3 + 1.4*smoothstep(0.25, 0.75, nL);
  float arm  = pow(0.5 + 0.5*cos(ph), 4.0);                        // broad arm
  float crest = pow(0.5 + 0.5*cos(ph), 16.0);                      // bright arm crest
  float lane = pow(0.5 + 0.5*cos(ph - 0.55), 18.0);                // dust lane on the leading edge
  float spur = pow(0.5 + 0.5*cos(ph*2.0 + n*4.5), 10.0)*0.35;      // feathery inter-arm spurs
  float thick = exp(-ay/1.0), thin = exp(-ay/0.32);
  float edge = 1.0 - smoothstep(76.0, 110.0, r);
  float disk = exp(-r/24.0);
  float bulge = exp(-length(p*vec3(1.0,1.8,1.0))/4.2);
  vec2 bq = vec2(p.x*0.878 + p.z*0.479, (p.z*0.878 - p.x*0.479)*3.2);
  float bar = exp(-length(bq)/7.0)*thick;                          // central bar
  float hii  = smoothstep(0.64, 0.86, nf)*(crest + arm*0.4)*seg;   // pink star-forming knots
  float blue = smoothstep(0.62, 0.80, nf*(1.0 - n) + n*0.25)*arm;  // young blue clusters
  em  = vec3(1.0,0.78,0.52)*disk*thick*0.32                        // warm old-star glow between the arms
      + vec3(0.34,0.55,1.0)*(arm*0.85 + crest*1.3 + spur*1.5)*seg*thin*exp(-r/46.0)*(0.35 + 1.5*n)
      + vec3(1.0,0.24,0.48)*hii*thin*exp(-r/48.0)*9.0
      + vec3(0.70,0.86,1.0)*blue*thin*exp(-r/48.0)*2.8
      + vec3(1.0,0.74,0.44)*(bulge*1.9 + bar*0.6);                  // golden core + bar
  em *= edge;
  ext = (lane*3.8*(0.4 + n) + spur*0.5 + 0.10*n)*thin*exp(-r/55.0)*edge
      + lane*thick*0.3*exp(-r/40.0);
}
vec3 galaxyVol(vec3 ro, vec3 rd, out float trans, float N){
  trans = 1.0;
  float b = dot(ro, rd), c = dot(ro, ro) - 112.0*112.0, h = b*b - c;
  if(h < 0.0) return vec3(0.0);
  h = sqrt(h);
  float t0 = max(-b - h, 0.0), t1 = -b + h;
  const float SLAB = 5.0;
  if(abs(rd.y) > 1e-5){
    float ta = (SLAB - ro.y)/rd.y, tb = (-SLAB - ro.y)/rd.y;
    t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb));
  } else if(abs(ro.y) > SLAB) return vec3(0.0);
  if(t1 <= t0) return vec3(0.0);
  float jit = ign(gl_FragCoord.xy + uFrame*5.588238);
  vec3 col = vec3(0.0);
  for(int i=uZero;i<96;i++){
    if(float(i) >= N) break;
    float f = (float(i) + jit)/N;
    float t = t0 + (t1 - t0)*f*f;                    // denser samples close to the eye
    float dt = (t1 - t0)*(2.0*f + 1.0/N)/N;
    vec3 em; float ex;
    galaxyAt(ro + rd*t, em, ex);
    col += trans*em*dt;
    trans *= exp(-ex*dt);
    if(trans < 0.02) break;
  }
  return col;
}

`;

// ── SKY BAKE: static, direction-only sky → cubemap (once at load) ────────────
const FS_BAKE = `#version 300 es
precision highp float;
out vec4 frag;
uniform int uFace, uWhich;
uniform float uSize;
uniform float uFrame;
${COMMON}
${GALAXY}
const vec3 BAND_N = vec3(0.3328, 0.8875, -0.3189);
vec3 galaxy(vec3 d, vec3 c, vec3 tiltAxis, float size, float incl, float arms, float wind, vec3 tint){
  float cd = dot(d, c);
  if(cd < 1.0 - size*size*40.0) return vec3(0.0);
  vec3 u = normalize(cross(c, tiltAxis)); vec3 v = cross(c, u);
  vec2 q = vec2(dot(d,u), dot(d,v))/size;
  q.y /= incl;
  float r = length(q), a = atan(q.y, q.x);
  float spiral = pow(0.5 + 0.5*cos(arms*(a - log(r+0.02)*wind)), 3.0);
  float mottled = 0.6 + 0.8*vnoise(vec3(q*9.0, size*100.0));
  float dsk  = exp(-r*3.2) * (0.25 + 1.4*spiral*smoothstep(0.04,0.35,r)) * mottled;
  float core = exp(-r*r*70.0)*2.2 + exp(-r*r*12.0)*0.5;
  return (tint*dsk + vec3(1.0,0.86,0.62)*core) * 0.45;
}
const vec3 G_DIR[7] = vec3[7](vec3( 0.55, 0.30,-0.78), vec3(-0.70, 0.12,-0.70), vec3( 0.12,-0.35,-0.93), vec3(-0.30,-0.10,-0.95), vec3( 0.85,-0.20,-0.48), vec3(-0.85, 0.05,-0.52), vec3(-0.15, 0.20, 0.97));
const vec3 G_TILT[7] = vec3[7](vec3(0.2,1.0,0.1), vec3(1.0,0.3,0.2), vec3(0.4,0.2,1.0), vec3(0.9,0.9,0.1), vec3(0.1,0.6,1.0), vec3(0.3,1.0,0.6), vec3(0.6,0.8,0.1));
const vec4 G_P[7] = vec4[7](vec4(0.030,0.45,2.0,2.4), vec4(0.022,0.80,2.0,3.0), vec4(0.016,0.30,2.0,2.0), vec4(0.010,0.60,3.0,2.6), vec4(0.020,0.25,2.0,2.2), vec4(0.026,0.55,2.0,2.8), vec4(0.040,0.40,2.0,2.5));
const vec3 G_TINT[7] = vec3[7](vec3(0.70,0.80,1.00), vec3(0.95,0.85,1.00), vec3(1.00,0.80,0.70), vec3(0.80,0.90,1.00), vec3(1.00,0.92,0.80), vec3(0.75,0.85,1.00), vec3(0.75,0.85,1.00));
vec3 faceDir(){
  vec2 st = gl_FragCoord.xy/uSize*2.0 - 1.0;
  float sc = st.x, tc = st.y;
  if(uFace == 0) return vec3( 1.0, -tc, -sc);
  if(uFace == 1) return vec3(-1.0, -tc,  sc);
  if(uFace == 2) return vec3( sc,  1.0,  tc);
  if(uFace == 3) return vec3( sc, -1.0, -tc);
  if(uFace == 4) return vec3( sc, -tc,  1.0);
  return vec3(-sc, -tc, -1.0);
}
void main(){
  vec3 d = normalize(faceDir());
  vec3 c = vec3(0.0); float a = 0.0;
  if(uWhich == 0){                      // sky around the black hole
    float bd = dot(d, BAND_N);
    float band = exp(-bd*bd*9.0);
    float dust = smoothstep(0.48, 0.74, fbm4(d*7.1 + 11.0));
    c += nebula(d, vec3(0.16,0.28,0.95), vec3(0.85,0.16,0.48), vec3(1.0,0.52,0.20), 0.045, 0.0)*(0.1+0.9*band);
    float glow = fbm4(d*3.1 + 7.0);
    c += band*band*(vec3(0.022,0.019,0.022)*glow + vec3(0.006,0.0045,0.003))*(1.0 - 0.8*dust);
    for(int i=uZero;i<7;i++) c += galaxy(d, normalize(G_DIR[i]), G_TILT[i], G_P[i].x, G_P[i].y, G_P[i].z, G_P[i].w, G_TINT[i]);
    a = dust*band;
  } else if(uWhich == 2){               // the Milky Way as seen from the Sun (rgb) + transmittance (a)
    float tr;
    c = galaxyVol(PSUN, d, tr, 96.0);
    a = tr;
  } else {                              // deep intergalactic sky behind our galaxy
    for(int i=uZero;i<7;i++) c += galaxy(d, normalize(G_DIR[i].zxy*vec3(1,-1,1)), G_TILT[i], G_P[i].x*0.7, G_P[i].y, G_P[i].z, G_P[i].w, G_TINT[i])*0.6;
  }
  frag = vec4(c, a);
}`;

// ── SPACE: galaxy volume + 3D stars + solar system ───────────────────────────
const FS_SPACE = `#version 300 es
precision highp float;
out vec4 frag;
uniform vec2  uRes, uJitter;
uniform float uTan, uTime, uFrame, uFade, uCell, uGal;
uniform vec3  uEyeG, uEyeS, uCX, uCY, uCZ;
uniform vec4  uPl[9];
uniform samplerCube uSky;           // deep intergalactic sky (baked)
uniform float uInGal;
uniform sampler2D tSun, tMer, tVen, tEarth, tNight, tCloud, tMoon, tMars, tJup, tSat, tUra, tNep, tRing, tPano;
uniform float uTex, uPanoMix, uPanoRot, uPanoGain, uGalSteps;   // uTex = real planet maps loaded
${COMMON}
${GALAXY}

// 3D star field: walk the grid cells the ray crosses → true parallax and depth
vec3 stars3D(vec3 ro, vec3 rd, float cell, float pixAng, float seed){
  vec3 p = ro/cell; vec3 ip = floor(p);
  vec3 st = sign(rd); vec3 dl = abs(1.0/max(abs(rd), vec3(1e-6)));
  vec3 side = (st*(ip - p) + st*0.5 + 0.5)*dl;
  vec3 c = vec3(0.0);
  for(int i=uZero;i<22;i++){
    vec3 cc = (ip + 0.5)*cell;
    float h = hash13(ip + seed);
    float dens = min(starDensity(cc)/0.12, 4.0);
    if(h < 0.45*dens){
      vec3 sp = (ip + vec3(hash13(ip+1.7+seed), hash13(ip+3.1+seed), hash13(ip+5.3+seed)))*cell;
      vec3 v = sp - ro; float t = dot(v, rd);
      if(t > 0.0){
        float perp = length(v - rd*t);
        float ang = perp/t;
        float w = pixAng*0.75;
        float lum = (0.3 + 3.0*pow(hash13(ip+8.8+seed), 6.0)) * min((cell*cell*4.0)/(t*t), 6.0);
        vec3 tint = blackbody(mix(3000.0, 11000.0, hash13(ip+2.2+seed)));
        c += tint*lum*(exp(-ang*ang/(w*w)) + 0.04*exp(-ang/(w*6.0)));
      }
    }
    if(side.x < side.y && side.x < side.z){ side.x += dl.x; ip.x += st.x; }
    else if(side.y < side.z){ side.y += dl.y; ip.y += st.y; }
    else { side.z += dl.z; ip.z += st.z; }
  }
  return c;
}

// ── solar system (system frame) ───────────────────────────────
const vec3 SUN_COL = vec3(1.0, 0.78, 0.52);
const float SUN_R = 2.0;

vec3 ringTint(float x){ return mix(vec3(0.86,0.76,0.60), vec3(0.70,0.66,0.62), x); }

// rings: returns colour (premultiplied) + alpha at ray parameter tR
vec4 rings(vec3 ro, vec3 rd, vec3 C, float R, vec3 n, float r0, float r1, float dens, out float tR){
  tR = dot(C - ro, n)/dot(rd, n);
  if(tR <= 0.0) return vec4(0.0);
  vec3 p = ro + rd*tR; float rr = length(p - C);
  if(rr < R*r0 || rr > R*r1) return vec4(0.0);
  float x = (rr - R*r0)/(R*(r1 - r0));
  float bands = 0.55 + 0.45*sin(x*95.0 + vnoise(vec3(x*45.0,0.0,0.0))*6.0);
  bands *= smoothstep(0.0,0.03,x)*smoothstep(1.0,0.92,x);
  bands *= 1.0 - 0.9*smoothstep(0.018,0.0,abs(x-0.6));       // Cassini division
  vec3 L = normalize(-p);
  float sh = sph(p, L, C, R) > 0.0 ? 0.06 : 1.0;             // planet shadow on the ring
  float a = clamp(bands*dens, 0.0, 1.0);
  vec3 tint = ringTint(x);
  if(uTex > 0.5 && dens > 0.5){                       // Saturn: real ring photograph (colour + opacity)
    vec4 rt = textureLod(tRing, vec2(x, 0.5), 0.0);
    tint = rt.rgb; a = rt.a*0.95;
  }
  vec3 col = tint*sh*(0.25 + 0.85*abs(dot(n, L)));
  return vec4(col*a, a);
}

vec3 planetSurface(int i, vec3 N, vec3 Nl, vec3 L, vec3 V){
  float lat = Nl.y;
  vec3 alb; float spec = 0.0; vec3 atm = vec3(0.0); vec3 night = vec3(0.0);
  if(i == 0 || i == 8){                                     // Mercury, Moon
    float f = fbm4(Nl*3.5);
    alb = vec3(0.55,0.53,0.50)*(0.65 + 0.5*f);
    alb *= 0.8 + 0.3*smoothstep(0.6,0.9,vnoise(Nl*18.0));
    if(i == 8) alb *= 1.0 - 0.35*smoothstep(0.5,0.7,fbm4(Nl*1.3+4.0));
  } else if(i == 1){                                        // Venus
    float f = fbm4(vec3(Nl.x*2.0, Nl.y*7.0, Nl.z*2.0) + vec3(uTime*0.01,0,0));
    alb = mix(vec3(0.85,0.72,0.50), vec3(0.97,0.90,0.74), f);
    atm = vec3(1.0,0.85,0.6);
  } else if(i == 2){                                        // Earth
    float c = fbm5(Nl*2.3);
    float land = smoothstep(0.52, 0.56, c);
    vec3 ocean = vec3(0.02,0.07,0.20);
    vec3 ground = mix(vec3(0.10,0.22,0.06), vec3(0.55,0.42,0.25), smoothstep(0.58,0.72,c));
    alb = mix(ocean, ground, land);
    float ice = smoothstep(0.80, 0.86, abs(lat) + 0.05*vnoise(Nl*9.0));
    alb = mix(alb, vec3(0.92,0.95,1.0), ice);
    float cl = smoothstep(0.50, 0.72, fbm5(Nl*3.2 + vec3(uTime*0.006, 0.0, 0.0)));
    alb = mix(alb, vec3(0.95), cl*0.85);
    spec = (1.0 - land)*(1.0 - cl)*(1.0 - ice);
    atm = vec3(0.35,0.6,1.0);
    night = vec3(1.0,0.72,0.35)*land*(1.0 - ice)*(1.0 - cl)*smoothstep(0.55,0.85,vnoise(Nl*40.0))*0.35;
  } else if(i == 3){                                        // Mars
    float f = fbm5(Nl*2.6);
    alb = mix(vec3(0.55,0.22,0.10), vec3(0.78,0.45,0.25), f);
    alb = mix(alb, vec3(0.35,0.16,0.10), smoothstep(0.55,0.7,fbm4(Nl*1.5+2.0))*0.6);
    alb = mix(alb, vec3(0.95,0.92,0.9), smoothstep(0.90,0.94,abs(lat)));
    atm = vec3(0.9,0.55,0.35)*0.35;
  } else if(i == 4){                                        // Jupiter
    float tb = fbm4(Nl*vec3(4.0,1.0,4.0) + vec3(uTime*0.01,0,0));
    float bands = 0.5 + 0.5*sin(lat*24.0 + tb*3.5);
    alb = mix(vec3(0.72,0.55,0.40), vec3(0.95,0.90,0.80), bands);
    alb = mix(alb, vec3(0.62,0.38,0.24), smoothstep(0.6,0.8,fbm4(Nl*vec3(6.0,2.0,6.0)))*0.4);
    vec2 spot = vec2(atan(Nl.z, Nl.x) - 1.2, (lat + 0.36)*3.2);
    alb = mix(alb, vec3(0.78,0.33,0.20), smoothstep(0.35, 0.18, length(spot))*0.9);   // Great Red Spot
  } else if(i == 5){                                        // Saturn
    float tb = fbm4(Nl*vec3(3.0,1.0,3.0));
    alb = mix(vec3(0.82,0.70,0.48), vec3(0.95,0.88,0.70), 0.5 + 0.5*sin(lat*20.0 + tb*2.0));
  } else if(i == 6){                                        // Uranus
    alb = mix(vec3(0.55,0.80,0.84), vec3(0.65,0.88,0.90), 0.5 + 0.5*sin(lat*8.0));
    atm = vec3(0.6,0.9,1.0)*0.6;
  } else {                                                  // Neptune
    float tb = fbm4(Nl*vec3(3.0,1.0,3.0));
    alb = mix(vec3(0.16,0.30,0.75), vec3(0.30,0.48,0.90), 0.5 + 0.5*sin(lat*14.0 + tb*3.0));
    vec2 spot = vec2(atan(Nl.z, Nl.x) + 0.8, (lat + 0.3)*3.0);
    alb = mix(alb, vec3(0.08,0.14,0.40), smoothstep(0.3, 0.15, length(spot)));
    atm = vec3(0.4,0.6,1.0)*0.6;
  }
  float nl = dot(N, L);
  float diff = max(nl, 0.0);
  vec3 col = alb*diff*SUN_COL*1.6;
  col += alb*0.0025;                                        // faint starlight on the night side
  if(spec > 0.0){
    vec3 H = normalize(L + V);
    col += SUN_COL*pow(max(dot(N, H), 0.0), 80.0)*spec*0.9*diff;
  }
  col += night*smoothstep(0.05, -0.15, nl);
  if(atm.r + atm.g + atm.b > 0.0){
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col += atm*rim*smoothstep(-0.25, 0.4, nl)*0.9;
  }
  return col;
}


// ── photographic planet maps ──────────────────────────────────
uniform float uTexW[9];             // width of each planet map (depends on desktop / mobile set)
vec3 albedoTex(int id, vec2 uv, float lod){
  if(id == 0) return textureLod(tMer, uv, lod).rgb;
  if(id == 1) return textureLod(tVen, uv, lod).rgb;
  if(id == 2) return textureLod(tEarth, uv, lod).rgb;
  if(id == 3) return textureLod(tMars, uv, lod).rgb;
  if(id == 4) return textureLod(tJup, uv, lod).rgb;
  if(id == 5) return textureLod(tSat, uv, lod).rgb;
  if(id == 6) return textureLod(tUra, uv, lod).rgb;
  if(id == 7) return textureLod(tNep, uv, lod).rgb;
  return textureLod(tMoon, uv, lod).rgb;
}
float TEXW_SAFE(float w){ return max(w, 1.0); }
vec3 planetTextured(int id, vec3 N, vec3 Nl, vec3 L, vec3 V, float t, float R, float pixAng, float spin){
  float mu = max(dot(N, V), 0.12);
  float W = uTexW[id];
  float lodRaw = log2(TEXW_SAFE(W)*0.159*(pixAng*t/R)/mu);
  float lod = max(lodRaw - 0.5, 0.0);                              // footprint-matched mip, slightly sharpened
  vec2 uv = eqUV(Nl);
  vec3 alb = albedoTex(id, uv, lod);
  vec3 Nb = N;
  if(id == 0 || id == 3 || id == 8 || id == 4 || id == 5){         // relief from the photo: craters / cloud decks catch light
    float e = max(exp2(lod), 1.0)/W;
    float h0 = luma(alb);
    float hx = luma(albedoTex(id, uv + vec2(e, 0.0), lod));
    float hy = luma(albedoTex(id, uv + vec2(0.0, e), lod));
    vec3 eastL = normalize(vec3(-Nl.z, 0.0, Nl.x) + 1e-5);
    vec3 east = vec3(eastL.x*cos(-spin) - eastL.z*sin(-spin), 0.0, eastL.x*sin(-spin) + eastL.z*cos(-spin));
    vec3 north = normalize(cross(east, N));
    float k = id == 3 ? 3.0 : (id == 4 || id == 5) ? 1.1 : 5.0;
    Nb = normalize(N - (east*(hx - h0) - north*(hy - h0))*k);
  }
  if(lodRaw < 0.0 && (id == 0 || id == 3 || id == 8)){              // closer than the photo resolves: add micro detail
    float md = smoothstep(0.0, -2.0, lodRaw);
    alb *= 1.0 + (vnoise(Nl*W*0.5) - 0.5)*0.22*md + (vnoise(Nl*W*1.7) - 0.5)*0.12*md;
  }
  float nl = dot(N, L);
  float diff = max(dot(Nb, L), 0.0)*smoothstep(-0.12, 0.12, nl);
  vec3 col = alb*diff*SUN_COL*1.75 + alb*0.0015;
  if(id == 2){                                                     // Earth: oceans, clouds, night lights
    float cl = textureLod(tCloud, uv, lod).r;
    float cs = textureLod(tCloud, uv + vec2(0.0018, -0.0012), lod).r;   // cloud shadows on the ground
    float ocean = smoothstep(0.015, 0.07, alb.b - alb.r);
    vec3 H = normalize(L + V);
    vec3 surf = alb*(1.0 - 0.55*cs)*diff*SUN_COL*1.75;
    surf += SUN_COL*pow(max(dot(N, H), 0.0), 140.0)*ocean*1.1*diff;
    vec3 night = textureLod(tNight, uv, lod).rgb;
    surf += night*night*vec3(1.0,0.78,0.5)*1.6*smoothstep(0.06, -0.2, dot(N, L));
    col = surf*(1.0 - cl) + cl*(diff*SUN_COL*1.9 + vec3(0.002));
    // atmosphere: blue haze thickening toward the limb, orange at the day/night line
    float haze = pow(1.0 - mu, 2.2);
    col = mix(col, vec3(0.32,0.56,1.0)*max(nl + 0.25, 0.0)*1.1, haze*0.5);
    float term = smoothstep(-0.18, 0.02, nl)*(1.0 - smoothstep(0.02, 0.3, nl));
    col += vec3(1.0,0.42,0.12)*term*(0.25 + 0.75*haze)*0.35;
  }
  if(id == 4 || id == 5) col *= 0.92 + 0.16*smoothstep(0.0, 0.6, mu);
  vec3 atm = id == 2 ? vec3(0.30,0.55,1.0) : id == 1 ? vec3(1.0,0.85,0.6) : id == 6 ? vec3(0.6,0.9,1.0)*0.6
           : id == 7 ? vec3(0.4,0.6,1.0)*0.6 : id == 3 ? vec3(0.9,0.55,0.35)*0.3 : vec3(0.0);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += atm*rim*smoothstep(-0.25, 0.4, dot(N, L))*0.9;
  return col;
}

// returns colour of whatever solid/ring is hit, alpha = coverage (1 if solid)
vec4 solarSystem(vec3 ro, vec3 rd, float pixAng, out float tHit){
  tHit = 1e20; int id = -1;
  float tS = sph(ro, rd, vec3(0.0), SUN_R);
  if(tS > 0.0){ tHit = tS; id = 100; }
  for(int i=uZero;i<9;i++){
    float t = sph(ro, rd, uPl[i].xyz, uPl[i].w);
    if(t > 0.0 && t < tHit){ tHit = t; id = i; }
  }
  vec4 res = vec4(0.0);
  if(id == 100){
    vec3 N = normalize(ro + rd*tS);
    float mu = max(dot(N, -rd), 0.0);
    float gran = 0.85 + 0.3*vnoise(N*55.0 + uTime*0.05) + 0.15*vnoise(N*9.0 - uTime*0.02);
    vec3 surf = SUN_COL*gran;
    if(uTex > 0.5){
      float sp = uTime*0.01;
      vec3 Ns = vec3(N.x*cos(sp) - N.z*sin(sp), N.y, N.x*sin(sp) + N.z*cos(sp));
      surf = textureLod(tSun, eqUV(Ns), 0.0).rgb*1.6*(0.9 + 0.2*gran);
    }
    res = vec4(surf*(0.35 + 0.65*pow(mu, 0.6))*26.0, 1.0);
  } else if(id >= 0){
    vec3 C = uPl[id].xyz;
    vec3 p = ro + rd*tHit; vec3 N = normalize(p - C);
    float spin = uTime*0.03*(id == 4 || id == 5 ? 2.0 : 1.0);
    vec3 Nl = vec3(N.x*cos(spin) - N.z*sin(spin), N.y, N.x*sin(spin) + N.z*cos(spin));
    vec3 L = normalize(-p);
    vec3 col = uTex > 0.5 ? planetTextured(id, N, Nl, L, -rd, tHit, uPl[id].w, pixAng, spin) : planetSurface(id, N, Nl, L, -rd);
    if(id == 5){                                            // ring shadow on Saturn
      vec3 nr = normalize(vec3(0.25,1.0,0.35));
      float tr = dot(C - p, nr)/dot(L, nr);
      if(tr > 0.0){ float rr = length(p + L*tr - C); if(rr > uPl[5].w*1.25 && rr < uPl[5].w*2.3) col *= 0.3; }
    }
    if(sph(p + N*1e-3, L, vec3(0.0), SUN_R) < 0.0){         // eclipses by the Moon / Earth
      float tm = id == 2 ? sph(p + N*1e-3, L, uPl[8].xyz, uPl[8].w) : (id == 8 ? sph(p + N*1e-3, L, uPl[2].xyz, uPl[2].w) : -1.0);
      if(tm > 0.0) col *= 0.1;
    }
    res = vec4(col, 1.0);
  }
  // thin glowing atmosphere just outside the limb (Earth, Venus)
  for(int k=uZero;k<2;k++){
    int ai = k == 0 ? 2 : 1;
    vec3 C = uPl[ai].xyz; float R = uPl[ai].w;
    float b = dot(C - ro, rd);
    if(b > 0.0 && b < tHit){
      vec3 cp = ro + rd*b; float d = length(cp - C);
      float h = (d - R)/(R*(ai == 2 ? 0.045 : 0.06));
      if(h > 0.0 && h < 4.0){
        vec3 Ln = normalize(-C);
        float lit = smoothstep(-0.35, 0.35, dot(normalize(cp - C), Ln));
        vec3 ac = ai == 2 ? vec3(0.35,0.6,1.0) : vec3(1.0,0.86,0.62);
        res.rgb += ac*exp(-h*1.6)*lit*0.55*(1.0 - res.a);
      }
    }
  }
  // rings in front of whatever was hit
  float tR;
  vec4 rg = rings(ro, rd, uPl[5].xyz, uPl[5].w, normalize(vec3(0.25,1.0,0.35)), 1.25, 2.3, 0.9, tR);
  if(rg.a > 0.0 && tR < tHit){ res.rgb = rg.rgb + res.rgb*(1.0 - rg.a); res.a = rg.a + res.a*(1.0 - rg.a); }
  vec4 ru = rings(ro, rd, uPl[6].xyz, uPl[6].w, normalize(vec3(1.0,0.12,0.2)), 1.6, 1.75, 0.25, tR);
  if(ru.a > 0.0 && tR < tHit){ res.rgb = ru.rgb + res.rgb*(1.0 - ru.a); res.a = ru.a + res.a*(1.0 - ru.a); }
  return res;
}

// sunlight scattered around the disc; also how the Sun looks as a far-away star
vec3 sunGlow(vec3 ro, vec3 rd, float pixAng){
  float dS = length(ro);
  vec3 sd = -ro/dS;
  float c = dot(rd, sd);
  if(c <= 0.0) return vec3(0.0);
  float ang = length(cross(rd, sd));
  float angR = SUN_R/dS;
  float w = max(angR, pixAng*0.7);
  float flux = min(1.0, (angR/(pixAng*0.7))*(angR/(pixAng*0.7)));
  // star-like point while the disc is unresolved (the disc itself is drawn by solarSystem)
  float pointMix = dS >= 2500.0 ? 1.0 : 1.0 - smoothstep(pixAng*0.8, pixAng*2.5, angR);
  vec3 g = SUN_COL*26.0*flux*exp(-(ang*ang)/(w*w))*pointMix;
  float near = smoothstep(4000.0, 300.0, dS);
  g += SUN_COL*near*(0.9*exp(-max(ang - angR, 0.0)/(angR*0.35 + 1e-4)) + 0.02*exp(-ang*18.0));   // tight corona, no sky-wide haze
  return g;
}

// asteroid belt between Mars and Jupiter (system frame, 3D cells)
vec3 asteroids(vec3 ro, vec3 rd, float pixAng){
  const float CELL = 0.22;
  vec3 p = ro/CELL; vec3 ip = floor(p);
  vec3 st = sign(rd); vec3 dl = abs(1.0/max(abs(rd), vec3(1e-6)));
  vec3 side = (st*(ip - p) + st*0.5 + 0.5)*dl;
  vec3 c = vec3(0.0);
  for(int i=uZero;i<30;i++){
    vec3 cc = (ip + 0.5)*CELL;
    float rr = length(cc.xz);
    float belt = smoothstep(12.0, 12.8, rr)*smoothstep(15.0, 14.2, rr)*smoothstep(0.55, 0.1, abs(cc.y));
    float h = hash13(ip + 41.0);
    if(h < 0.5*belt){
      vec3 sp = (ip + vec3(hash13(ip+1.7), hash13(ip+3.1), hash13(ip+5.3)))*CELL;
      vec3 v = sp - ro; float t = dot(v, rd);
      if(t > 0.0){
        float rad = 0.004 + 0.02*pow(hash13(ip+7.7), 4.0);
        float perp = length(v - rd*t);
        float w = max(rad, pixAng*t*0.7);
        float cov = exp(-perp*perp/(w*w)) * min(1.0, (rad*rad)/(w*w) + 0.15);
        float lit = 0.4 + 0.6*max(dot(normalize(v - rd*t + rd*rad), normalize(-sp)), 0.0);
        c += vec3(0.55,0.5,0.45)*cov*lit*0.9*smoothstep(25.0, 4.0, t);
      }
    }
    if(side.x < side.y && side.x < side.z){ side.x += dl.x; ip.x += st.x; }
    else if(side.y < side.z){ side.y += dl.y; ip.y += st.y; }
    else { side.z += dl.z; ip.z += st.z; }
  }
  return c;
}

void main(){
  vec2 fc = gl_FragCoord.xy + uJitter;
  vec2 uv = (fc*2.0 - uRes)/uRes.y;
  vec3 rd = normalize(uCX*uv.x*uTan + uCY*uv.y*uTan - uCZ);
  float pixAng = 2.0*uTan/uRes.y;

  // background: deep sky + far stars, seen through the galaxy volume
  float trans = 1.0; vec3 col = vec3(0.0);
  if(uPanoMix < 0.999){                                    // the galaxy, rendered as a 3D volume
    vec3 gal = galaxyVol(uEyeG, rd, trans, uGalSteps)*uGal;
    float plane = exp(-rd.y*rd.y*14.0);
    col = (texture(uSky, rd).rgb + stars(rd, pixAng, 0.35 + uInGal*(0.9 + 1.4*plane), uInGal*plane)*0.6)*max(trans, 0.35*uInGal) + gal;
  }
  if(uPanoMix > 0.001){                                    // ...which becomes the real Milky Way photo once we're inside it
    float cr = cos(uPanoRot), sr = sin(uPanoRot);
    vec3 pd = vec3(cr*rd.x - sr*rd.z, rd.y, sr*rd.x + cr*rd.z);
    col = mix(col, textureLod(tPano, eqUV(pd), 0.0).rgb*uPanoGain, uPanoMix);
  }
  float sf = 1.0 - 0.75*uPanoMix;
  col += stars3D(uEyeG, rd, uCell, pixAng, 0.0)*(0.3 + 0.7*trans)*sf;
  col += stars3D(uEyeG, rd, uCell*5.0, pixAng, 19.0)*(0.3 + 0.7*trans)*0.8*sf;

  // the Sun and its planets
  float dS = length(uEyeS);
  col += sunGlow(uEyeS, rd, pixAng);
  if(dS < 2500.0){
    float tHit;
    vec4 ss = solarSystem(uEyeS, rd, pixAng, tHit);
    col = ss.rgb + col*(1.0 - ss.a);
    if(dS < 60.0) col += asteroids(uEyeS, rd, pixAng)*(1.0 - ss.a);
  }
  frag = vec4(max(col, 0.0)*uFade, 1.0);
}`;

// ── TAA / upscale / bloom / composite ────────────────────────────────────────
const FS_TAA = `#version 300 es
precision highp float;
out vec4 frag;
uniform sampler2D uCur, uHist;
uniform float uBlend;
uniform ivec2 uMax;
${COMMON}
vec3 tm(vec3 c){ return c/(1.0+luma(c)); }
vec3 itm(vec3 c){ return c/max(1.0-luma(c), 1e-3); }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = tm(texelFetch(uCur, p, 0).rgb);
  vec3 mn = c, mx = c;
  for(int y=uZero-1;y<=1;y++) for(int x=uZero-1;x<=1;x++){
    if(x==0 && y==0) continue;
    vec3 s = tm(texelFetch(uCur, clamp(p+ivec2(x,y), ivec2(0), uMax), 0).rgb);
    mn = min(mn,s); mx = max(mx,s);
  }
  vec3 h = clamp(tm(texelFetch(uHist, p, 0).rgb), mn, mx);
  frag = vec4(itm(mix(c, h, uBlend)), 1.0);
}`;

const FS_UP = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex;
uniform vec2 uScale, uTexel;
uniform float uSharp;
void main(){
  vec2 uv = vUv*uScale;
  vec3 c = texture(uTex, uv).rgb;
  vec3 b = texture(uTex, uv+vec2(uTexel.x,0.0)).rgb + texture(uTex, uv-vec2(uTexel.x,0.0)).rgb
         + texture(uTex, uv+vec2(0.0,uTexel.y)).rgb + texture(uTex, uv-vec2(0.0,uTexel.y)).rgb;
  frag = vec4(max(c + (c - b*0.25)*uSharp, 0.0), 1.0);
}`;

const FS_DOWN = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex; uniform vec2 uTexel; uniform float uFirst, uTh;
${COMMON}
vec3 karis(vec3 a, vec3 b, vec3 c, vec3 d){
  float wa=1.0/(1.0+luma(a)), wb=1.0/(1.0+luma(b)), wc=1.0/(1.0+luma(c)), wd=1.0/(1.0+luma(d));
  return (a*wa+b*wb+c*wc+d*wd)/(wa+wb+wc+wd);
}
void main(){
  vec2 t = uTexel;
  vec3 A=texture(uTex,vUv+t*vec2(-2, 2)).rgb, B=texture(uTex,vUv+t*vec2(0, 2)).rgb, C=texture(uTex,vUv+t*vec2(2, 2)).rgb;
  vec3 D=texture(uTex,vUv+t*vec2(-1, 1)).rgb, E=texture(uTex,vUv+t*vec2(1, 1)).rgb;
  vec3 F=texture(uTex,vUv+t*vec2(-2, 0)).rgb, G=texture(uTex,vUv).rgb,               H=texture(uTex,vUv+t*vec2(2, 0)).rgb;
  vec3 I=texture(uTex,vUv+t*vec2(-1,-1)).rgb, J=texture(uTex,vUv+t*vec2(1,-1)).rgb;
  vec3 K=texture(uTex,vUv+t*vec2(-2,-2)).rgb, L=texture(uTex,vUv+t*vec2(0,-2)).rgb, Mm=texture(uTex,vUv+t*vec2(2,-2)).rgb;
  vec3 c;
  if(uFirst > 0.5){
    c = karis(D,E,I,J)*0.5 + karis(A,B,F,G)*0.125 + karis(B,C,G,H)*0.125 + karis(F,G,K,L)*0.125 + karis(G,H,L,Mm)*0.125;
    float br = max(c.r,max(c.g,c.b));
    float knee = uTh*0.6;
    float rq = clamp(br-uTh+knee, 0.0, 2.0*knee); rq = rq*rq/(4.0*knee+1e-4);
    c *= max(rq, br-uTh)/max(br,1e-4);
  } else {
    c = (D+E+I+J)*0.125 + (A+C+K+Mm)*0.03125 + (B+F+H+L)*0.0625 + G*0.125;
  }
  frag = vec4(c,1.0);
}`;

const FS_UPS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uTex; uniform vec2 uTexel;
void main(){
  vec2 t = uTexel;
  vec3 c = texture(uTex,vUv).rgb*4.0;
  c += (texture(uTex,vUv+vec2(t.x,0)).rgb + texture(uTex,vUv-vec2(t.x,0)).rgb
      + texture(uTex,vUv+vec2(0,t.y)).rgb + texture(uTex,vUv-vec2(0,t.y)).rgb)*2.0;
  c +=  texture(uTex,vUv+t).rgb + texture(uTex,vUv-t).rgb
      + texture(uTex,vUv+vec2(t.x,-t.y)).rgb + texture(uTex,vUv+vec2(-t.x,t.y)).rgb;
  frag = vec4(c/16.0, 1.0);
}`;

const FS_COMP = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 frag;
uniform sampler2D uScene, uBloom;
uniform float uBloomAmt, uExposure, uTime, uGrain, uCA;
uniform vec2 uRes;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
void main(){
  vec2 d = vUv-0.5;
  vec2 off = d*dot(d,d)*uCA;
  vec3 c = vec3(texture(uScene, vUv+off).r, texture(uScene, vUv).g, texture(uScene, vUv-off).b);
  c += texture(uBloom, vUv).rgb*uBloomAmt;
  c *= uExposure;
  c = aces(c);
  c = pow(c, vec3(1.0/2.2));
  float vig = smoothstep(1.25, 0.3, length(d*vec2(uRes.x/uRes.y,1.0)));
  c *= mix(0.72, 1.0, vig);
  vec2 gp = vUv*uRes + fract(uTime*7.31)*vec2(113.0,57.0);
  c += (hash(gp) + hash(gp+17.17) - 1.0)*uGrain*(0.35 + 0.65*(1.0-c));
  frag = vec4(max(c,0.0), 1.0);
}`;

// ═════════════════════════════════════════════════════════════════════════════
//  CAMERA MATH
// ═════════════════════════════════════════════════════════════════════════════
// Fritsch–Carlson monotone cubic (C1, never overshoots, never stalls mid-way)
export function monotone(pts, x) {
  const n = pts.length;
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[n - 1][0]) return pts[n - 1][1];
  const d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let i = 0; while (x > pts[i + 1][0]) i++;
  const h = pts[i + 1][0] - pts[i][0], t = (x - pts[i][0]) / h, t2 = t * t, t3 = t2 * t;
  return (2*t3 - 3*t2 + 1) * pts[i][1] + (t3 - 2*t2 + t) * h * m[i] + (-2*t3 + 3*t2) * pts[i + 1][1] + (t3 - t2) * h * m[i + 1];
}
// C1 Catmull-Rom on a non-uniform knot, for 3D keys
function spline3(keys, u, get, holdZero = false) {
  const n = keys.length;
  if (u <= keys[0].u) return get(keys[0]);
  if (u >= keys[n - 1].u) return get(keys[n - 1]);
  let i = 0; while (u > keys[i + 1].u) i++;
  const k0 = keys[i], k1 = keys[i + 1], h = k1.u - k0.u, t = (u - k0.u) / h;
  const tan = j => {
    if (holdZero && keys[j].hold) return [0, 0, 0];       // aim stays locked on the planet while its page shows
    const a = keys[Math.max(0, j - 1)], b = keys[Math.min(n - 1, j + 1)];
    return mul(sub(get(b), get(a)), h / (b.u - a.u));
  };
  const m0 = tan(i), m1 = tan(i + 1), p0 = get(k0), p1 = get(k1);
  const t2 = t * t, t3 = t2 * t;
  return add(add(mul(p0, 2*t3 - 3*t2 + 1), mul(m0, t3 - 2*t2 + t)), add(mul(p1, -2*t3 + 3*t2), mul(m1, t3 - t2)));
}

const LOGDIST = FLIGHT.dist.map(([q, d]) => [q, Math.log(d)]);
export function sampleCamera(p) {
  const F = FLIGHT;
  const a = 0.12, c = 1 / (1 - a / 2);
  const k = clamp01(p < a ? c * p * p / (2 * a) : c * (p - a / 2));
  const r = Math.exp(monotone(LOGDIST, k));
  const e = smooth(0, 1, k);
  const elev = lerp(F.elev0, F.elev1, e) * D2R;
  const az = lerp(F.az0, F.az1, e) * D2R;
  const eye = [r * Math.cos(elev) * Math.sin(az), r * Math.sin(elev), r * Math.cos(elev) * Math.cos(az)];
  const target = [0, -F.lift * r * (1 - e), 0];
  return { eye, target, r, fov: monotone(F.fov, k) * D2R, roll: lerp(F.roll0, F.roll1, e) };
}

// one camera, two frames. Returns galaxy-frame eye, system-frame eye (double
// precision in JS, so the hand-off never jitters), target direction, fov.
export function spaceCamera(u) {
  if (u < U_HAND) {
    const dg = Math.exp(monotone(DG, u));
    const s = smooth(0.05, 0.38, u);
    const D0 = norm([0.62, 0.66, 1.0]);
    const D = norm(vlerp(D0, DEND, s));
    const eyeG = add(PSUN, mul(D, dg));
    // look at the galaxy (framed to the right of the page) → then at the Sun
    const toCore = norm(sub([0, 0, 0], eyeG));
    const right = norm(cross(toCore, [0, 1, 0]));
    const coreAim = MOBILE ? [0, 0, 0] : add([0, 0, 0], mul(right, -36));   // galaxy beside / above the text
    const tgtG = vlerp(coreAim, PSUN, smooth(0.20, 0.37, u));
    const dir = norm(sub(tgtG, eyeG));
    return { eyeG, eyeS: mul(sub(eyeG, PSUN), K), dir, fov: lerp(44, 52, smooth(0.2, 0.42, u)) * D2R, dg };
  }
  const eyeS = spline3(SYS_KEYS, u, k => k.eye);
  const tgtS = spline3(SYS_KEYS, u, k => k.target, true);
  return { eyeG: add(PSUN, mul(eyeS, 1 / K)), eyeS, dir: norm(sub(tgtS, eyeS)), fov: 52 * D2R, dg: Math.hypot(...eyeS) / K };
}

function basis(eye, target, roll) {
  const z = norm(sub(eye, target));
  const up = [Math.sin(roll), Math.cos(roll), 0];
  const x = norm(cross(up, z));
  return { x, y: cross(z, x), z };
}
function basisDir(dir, roll) {
  const z = mul(dir, -1);
  const up = [Math.sin(roll), Math.cos(roll), 0];
  const x = norm(cross(up, z));
  return { x, y: cross(z, x), z };
}
const TEX_KEYS = ['tPano', 'tSun', 'tMer', 'tVen', 'tEarth', 'tNight', 'tCloud', 'tMoon', 'tMars', 'tJup', 'tSat', 'tUra', 'tNep', 'tRing'];
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const JITTER = Array.from({ length: 8 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);

// ═════════════════════════════════════════════════════════════════════════════
//  GL PLUMBING
// ═════════════════════════════════════════════════════════════════════════════
function startPrograms(gl, defs) {
  const out = {};
  for (const name in defs) {
    const [vsrc, fsrc] = defs[name];
    const p = gl.createProgram();
    const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, vsrc); gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, fsrc); gl.compileShader(fs);
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    out[name] = { p, vs, fs, u: {} };
  }
  return out;
}
function finishPrograms(gl, progs) {
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  return new Promise((resolve, reject) => {
    const check = () => {
      if (ext && !Object.values(progs).every(o => gl.getProgramParameter(o.p, ext.COMPLETION_STATUS_KHR))) {
        setTimeout(check, 30); return;
      }
      for (const name in progs) {
        const o = progs[name];
        if (!gl.getProgramParameter(o.p, gl.LINK_STATUS)) {
          reject(new Error(`[${name}] ` + (gl.getShaderInfoLog(o.fs) || gl.getShaderInfoLog(o.vs) || gl.getProgramInfoLog(o.p))));
          return;
        }
        const n = gl.getProgramParameter(o.p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) {
          const inf = gl.getActiveUniform(o.p, i);
          const name2 = inf.name.replace(/\[0\]$/, '');
          o.u[name2] = gl.getUniformLocation(o.p, inf.name);
        }
        if (o.u.uZero) { gl.useProgram(o.p); gl.uniform1i(o.u.uZero, 0); }
      }
      resolve(progs);
    };
    check();
  });
}

// ═════════════════════════════════════════════════════════════════════════════
//  ENGINE
// ═════════════════════════════════════════════════════════════════════════════
export async function createBlackHole(canvas, opts = {}) {
  const { maxDpr = 1.5, maxPixels = 3.2e6, steps = 220, reducedMotion = false, mobile = false,
          texSet = mobile ? 'm' : 'hd', onProgress = () => {} } = opts;
  setLayout(mobile);
  const SKY_SIZE = mobile ? 384 : 768, DEEP_SIZE = mobile ? 256 : 512, GAL_STEPS = mobile ? 24 : 36;

  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    premultipliedAlpha: false, powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  const floatOK = !!gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');

  // compile everything in parallel; only the intro programs gate the loader
  const core = startPrograms(gl, {
    bh: [VS_FS, FS_BH], taa: [VS_FS, FS_TAA], up: [VS_FS, FS_UP],
    down: [VS_FS, FS_DOWN], ups: [VS_FS, FS_UPS], comp: [VS_FS, FS_COMP], bake: [VS_FS, FS_BAKE],
  });
  const lazy = startPrograms(gl, { space: [VS_FS, FS_SPACE] });
  const P = await finishPrograms(gl, core);

  const quad = gl.createVertexArray(); gl.bindVertexArray(quad);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function bakeSky(which, size) {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
    for (let f = 0; f < 6; f++) {
      if (floatOK) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, gl.RGBA16F, size, size, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const o = P.bake; gl.useProgram(o.p);
    gl.uniform1i(o.u.uWhich, which); gl.uniform1f(o.u.uSize, size);
    gl.viewport(0, 0, size, size); gl.disable(gl.BLEND); gl.bindVertexArray(quad);
    for (let f = 0; f < 6; f++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, tex, 0);
      gl.uniform1i(o.u.uFace, f);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb);
    return tex;
  }
  const SKY_HOLE = bakeSky(0, SKY_SIZE);

  // ── photographic textures (Solar System Scope, CC BY 4.0). Decoded off the
  //    main thread, uploaded one per frame so nothing hitches.
  // texture sets: textures/hd (desktop, ~6 MB) and textures/m (phones, ~1.2 MB), WebP.
  // Order = load priority: the landing sky and Moon first, then outward → inward.
  const TEX_FILES = {
    tPano: ['pano', true], tMoon: ['moon', true], tSun: ['sun', true], tNep: ['neptune', true], tUra: ['uranus', true],
    tSat: ['saturn', true], tRing: ['ring', false], tJup: ['jupiter', true], tMars: ['mars', true],
    tEarth: ['earth', true], tNight: ['night', true], tCloud: ['clouds', false], tVen: ['venus', true], tMer: ['mercury', true],
  };
  const TEXW = new Float32Array(9);   // planet map widths, filled as maps arrive
  const PL_KEY = ['tMer', 'tVen', 'tEarth', 'tMars', 'tJup', 'tSat', 'tUra', 'tNep', 'tMoon'];
  const TEX = {}, uploadQ = [];
  const dummy = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, dummy);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  let texDone = 0;
  const TEX_COUNT = Object.keys(TEX_FILES).length;
  for (const [key, [file, srgb]] of Object.entries(TEX_FILES)) {
    fetch(new URL(`../textures/${texSet}/${file}.webp`, import.meta.url))
      .then(r => { if (!r.ok) throw new Error(file + ' ' + r.status); return r.blob(); })
      .then(b => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
      .then(async bmp => {
        if (bmp.width > maxTex) bmp = await createImageBitmap(bmp, { resizeWidth: maxTex, resizeHeight: maxTex / 2, resizeQuality: 'high' });
        uploadQ.push([key, bmp, srgb]);
      })
      .catch(e => { console.warn('texture failed:', e.message); texDone++; });
  }
  function pumpUploads() {
    const job = uploadQ.shift(); if (!job) return;
    const [key, bmp, srgb] = job;
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    const pi = PL_KEY.indexOf(key); if (pi >= 0) TEXW[pi] = bmp.width;
    if (key === 'tMoon') MOON_W = bmp.width;
    if (bmp.close) bmp.close();
    TEX[key] = t; texDone++;
    onProgress(texDone / TEX_COUNT, key);
  }
  let MOON_W = 1024;
  const planetsReady = () => Object.keys(TEX_FILES).every(k => k === 'tPano' || TEX[k]);
  // landing sky: the panorama's galactic band runs along the plane with normal BAND_N
  const by = norm([0.3328, 0.8875, -0.3189]), bx = norm(cross(by, [0, 0, 1])), bz = cross(bx, by);
  const SKY_ROT = new Float32Array([bx[0], by[0], bz[0], bx[1], by[1], bz[1], bx[2], by[2], bz[2]]);
  // inside the galaxy: the panorama's centre faces the galactic centre
  const gc = norm(mul(PSUN, -1));
  const PANO_ROT = -Math.atan2(gc[2], gc[0]);
  let SKY_DEEP = null, spaceReady = false;
  const spacePromise = finishPrograms(gl, lazy).then(v => {
    SKY_DEEP = bakeSky(1, DEEP_SIZE);
    P.space = v.space; spaceReady = true;
  });

  function target(w, h, filter = gl.LINEAR) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    if (floatOK) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, f, w, h };
  }
  const kill = o => { if (o) { gl.deleteTexture(o.t); gl.deleteFramebuffer(o.f); } };

  let W = 0, H = 0, T = {}, mips = [];
  let scale = 0.72, historyValid = false;
  function resize() {
    let dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const cw = canvas.clientWidth || innerWidth, ch = canvas.clientHeight || innerHeight;
    const px = cw * ch * dpr * dpr;
    if (px > maxPixels) dpr *= Math.sqrt(maxPixels / px);
    const nw = Math.max(2, Math.round(cw * dpr)), nh = Math.max(2, Math.round(ch * dpr));
    if (nw === W && nh === H) return;
    W = nw; H = nh; canvas.width = W; canvas.height = H;
    Object.values(T).forEach(kill); mips.forEach(kill);
    T = { raw: target(W, H, gl.NEAREST), hA: target(W, H), hB: target(W, H), scene: target(W, H) };
    mips = [];
    for (let i = 0; i < 6; i++) mips.push(target(Math.max(1, W >> (i + 1)), Math.max(1, H >> (i + 1))));
    historyValid = false;
  }
  resize();

  const c0 = sampleCamera(0), b0 = basis(c0.eye, c0.target, c0.roll);
  const OPEN = { f: mul(b0.z, -1), x: b0.x, y: b0.y };
  let time = 0, frame = 0, diskT = 0, lastMode = '';
  let prevDir = null, prevPos = null;
  const out = { distance: 64, dilation: 1, inside: false };

  const fs = () => { gl.bindVertexArray(quad); gl.drawArrays(gl.TRIANGLES, 0, 3); };
  const bindTex = (unit, tex, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); };
  const setBasis = (o, B, tanH) => {
    gl.uniform3fv(o.u.uCX, B.x); gl.uniform3fv(o.u.uCY, B.y); gl.uniform3fv(o.u.uCZ, B.z);
    gl.uniform1f(o.u.uTan, tanH);
  };

  /** s = { mode:'hole', p } | { mode:'space', u, fade }, plus velocity & pointer */
  function render(dt, s) {
    time += dt; frame++;
    pumpUploads();
    const velocity = s.velocity || 0, pointer = reducedMotion ? [0, 0] : (s.pointer || [0, 0]);
    const speed = Math.min(Math.abs(velocity), 2);
    const iw = Math.max(2, Math.round(W * scale)), ih = Math.max(2, Math.round(H * scale));
    const j = JITTER[frame % JITTER.length];
    let B, motionPos, motion = 0;

    if (s.mode !== lastMode) { historyValid = false; lastMode = s.mode; }
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.raw.f); gl.viewport(0, 0, iw, ih);

    if (s.mode === 'hole') {
      diskT += dt * (1 + Math.min(speed, 1) * 2);
      const cam = sampleCamera(s.p);
      const calm = 1 - smooth(0.55, 0.95, s.p);
      if (!reducedMotion) cam.eye = add(cam.eye, [Math.sin(time * 0.37) * 0.06 * calm, Math.cos(time * 0.29) * 0.045 * calm, 0]);
      const B0 = basis(cam.eye, cam.target, cam.roll);
      const par = 0.02 * cam.r * calm;
      cam.eye = add(cam.eye, add(mul(B0.x, pointer[0] * par), mul(B0.y, -pointer[1] * par * 0.6)));
      B = basis(cam.eye, cam.target, cam.roll);
      const r = Math.hypot(...cam.eye);
      out.distance = r; out.dilation = Math.sqrt(Math.max(0, 1 - 1 / r)); out.inside = r < 1;
      motionPos = mul(cam.eye, 1 / Math.max(r, 1));

      const o = P.bh; gl.useProgram(o.p);
      gl.uniform2f(o.u.uRes, iw, ih); gl.uniform2f(o.u.uJitter, j[0], j[1]);
      gl.uniform1f(o.u.uFrame, frame % 64); gl.uniform1f(o.u.uTime, time);
      gl.uniform1f(o.u.uDiskT, diskT); gl.uniform1f(o.u.uBeam, 0.85);
      gl.uniform1f(o.u.uFar, Math.max(30, r * 1.15)); gl.uniform1f(o.u.uInside, r < 1 ? 1 : 0);
      gl.uniform3fv(o.u.uEye, cam.eye); setBasis(o, B, Math.tan(cam.fov / 2));
      gl.uniform1i(o.u.uSteps, steps);
      gl.uniform3fv(o.u.SF, OPEN.f); gl.uniform3fv(o.u.SR, OPEN.x); gl.uniform3fv(o.u.SU, OPEN.y);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_CUBE_MAP, SKY_HOLE); gl.uniform1i(o.u.uSky, 3);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, TEX.tPano || dummy); gl.uniform1i(o.u.tPano, 4);
      gl.uniform1f(o.u.uPano, TEX.tPano ? 1 : 0); gl.uniformMatrix3fv(o.u.uSkyRot, false, SKY_ROT);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, TEX.tMoon || dummy); gl.uniform1i(o.u.tMoonH, 5);
      gl.uniform1f(o.u.uMoonTex, TEX.tMoon ? 1 : 0); gl.uniform1f(o.u.uMoonW, MOON_W);
      fs();
    } else {
      const cam = spaceCamera(s.u);
      if (MOBILE) { const bt = basisDir(cam.dir, 0); cam.dir = norm(sub(cam.dir, mul(bt.y, 0.21))); }  // subject in the upper part on phones
      // gentle hand-held drift + pointer look-around (rotates the view, never the path)
      const look = [pointer[0] * 0.05 + (reducedMotion ? 0 : Math.sin(time * 0.21) * 0.006),
                    -pointer[1] * 0.035 + (reducedMotion ? 0 : Math.cos(time * 0.17) * 0.005)];
      const B0 = basisDir(cam.dir, 0);
      const dir = norm(add(cam.dir, add(mul(B0.x, look[0]), mul(B0.y, look[1]))));
      B = basisDir(dir, 0);
      const scaleNow = Math.max(cam.dg, 1e-7);
      motionPos = mul(cam.eyeG, 1 / scaleNow);
      if (!spaceReady) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      else {
        const o = P.space; gl.useProgram(o.p);
        gl.uniform2f(o.u.uRes, iw, ih); gl.uniform2f(o.u.uJitter, j[0], j[1]);
        gl.uniform1f(o.u.uTime, time); gl.uniform1f(o.u.uFrame, frame % 64);
        gl.uniform1f(o.u.uFade, s.fade ?? 1);
        gl.uniform1f(o.u.uGal, 0.14);
        // 3D star cells shrink as we zoom in, so there are always stars streaming past
        gl.uniform1f(o.u.uCell, Math.min(3.0, Math.max(0.02, cam.dg * 0.03)));
        gl.uniform3fv(o.u.uEyeG, cam.eyeG); gl.uniform3fv(o.u.uEyeS, cam.eyeS);
        const mp = moonPos(time); PL_UNIFORM[32] = mp[0]; PL_UNIFORM[33] = mp[1]; PL_UNIFORM[34] = mp[2];
        gl.uniform4fv(o.u.uPl, PL_UNIFORM);
        setBasis(o, B, Math.tan(cam.fov / 2));
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_CUBE_MAP, SKY_DEEP); gl.uniform1i(o.u.uSky, 1);
        TEX_KEYS.forEach((k, i) => { gl.activeTexture(gl.TEXTURE2 + i); gl.bindTexture(gl.TEXTURE_2D, TEX[k] || dummy); gl.uniform1i(o.u[k], 2 + i); });
        gl.uniform1f(o.u.uTex, planetsReady() ? 1 : 0);
        gl.uniform1fv(o.u.uTexW, TEXW); gl.uniform1f(o.u.uGalSteps, GAL_STEPS);
        // the volumetric galaxy hands over to the real Milky Way photo as we enter the disk
        gl.uniform1f(o.u.uPanoMix, TEX.tPano ? smooth(0.5, 0.03, cam.dg) : 0);
        gl.uniform1f(o.u.uPanoRot, PANO_ROT); gl.uniform1f(o.u.uPanoGain, 1.0);
        gl.uniform1f(o.u.uInGal, smooth(3.0, 0.05, cam.dg));
        fs();
      }
    }

    if (prevDir) {
      const dz = 1 - dot(B.z, prevDir);
      motion = Math.min(1, Math.hypot(...sub(motionPos, prevPos)) * 0.5) + dz * 40;
      if (s.mode !== 'hole') motion = dz * 40 + Math.min(0.4, Math.abs(velocity) * 0.3);
    }
    prevDir = B.z; prevPos = motionPos;

    // TAA
    let o = P.taa; gl.useProgram(o.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.hA.f); gl.viewport(0, 0, iw, ih);
    bindTex(0, T.raw.t, o.u.uCur); bindTex(1, T.hB.t, o.u.uHist);
    gl.uniform1f(o.u.uBlend, historyValid ? Math.max(0.3, 0.86 - motion * 6) : 0);
    gl.uniform2i(o.u.uMax, iw - 1, ih - 1);
    fs();
    [T.hA, T.hB] = [T.hB, T.hA];
    historyValid = true;

    // upscale
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.f); gl.viewport(0, 0, W, H);
    o = P.up; gl.useProgram(o.p);
    bindTex(0, T.hB.t, o.u.uTex);
    gl.uniform2f(o.u.uScale, iw / W, ih / H); gl.uniform2f(o.u.uTexel, 1 / W, 1 / H);
    gl.uniform1f(o.u.uSharp, 0.35 * (1 - scale) + 0.08);
    fs();

    // bloom
    o = P.down; gl.useProgram(o.p);
    let src = T.scene;
    for (let i = 0; i < mips.length; i++) {
      const d = mips[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.f); gl.viewport(0, 0, d.w, d.h);
      bindTex(0, src.t, o.u.uTex);
      gl.uniform2f(o.u.uTexel, 1 / src.w, 1 / src.h);
      gl.uniform1f(o.u.uFirst, i === 0 ? 1 : 0); gl.uniform1f(o.u.uTh, 1.8);
      fs(); src = d;
    }
    o = P.ups; gl.useProgram(o.p);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = mips.length - 2; i >= 0; i--) {
      const d = mips[i], sm = mips[i + 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.f); gl.viewport(0, 0, d.w, d.h);
      bindTex(0, sm.t, o.u.uTex); gl.uniform2f(o.u.uTexel, 1 / sm.w, 1 / sm.h);
      fs();
    }
    gl.disable(gl.BLEND);

    // composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    o = P.comp; gl.useProgram(o.p);
    bindTex(0, T.scene.t, o.u.uScene); bindTex(1, mips[0].t, o.u.uBloom);
    gl.uniform1f(o.u.uBloomAmt, 0.05); gl.uniform1f(o.u.uExposure, 0.95);
    gl.uniform1f(o.u.uTime, reducedMotion ? 0 : time);
    gl.uniform1f(o.u.uGrain, 0.025); gl.uniform1f(o.u.uCA, 0.002 + speed * 0.004);
    gl.uniform2f(o.u.uRes, W, H);
    fs();
    gl.activeTexture(gl.TEXTURE0);
    return out;
  }

  let acc = 0, n = 0, good = 0, ceiling = 1;
  function adapt(dt) {
    acc += dt; n++;
    if (acc < 0.6) return;
    const ms = (acc / n) * 1000; acc = 0; n = 0;
    if (ms > 19.5 && scale > 0.42) {
      ceiling = scale - 0.02;
      scale = Math.max(0.42, scale - 0.06); good = 0; historyValid = false;
    } else if (ms < 17.6) {
      if (++good >= 4 && scale + 0.04 <= ceiling) { scale += 0.04; good = 0; historyValid = false; }
    } else good = 0;
  }

  return { render, resize, adapt, gl, P, spaceReady: spacePromise, texProgress: () => texDone / TEX_COUNT,
           hasPano: () => !!TEX.tPano, get scale() { return scale; } };
}
