export const VERT = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4.0 - 1.0;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_mass;
uniform sampler2D u_hid;
ivec2 wrap(ivec2 p) {
  ivec2 n = textureSize(u_mass, 0);
  return (p + n) % n;
}
vec4 M(ivec2 p) { return texelFetch(u_mass, wrap(p), 0); }
vec4 H(ivec2 p) { return texelFetch(u_hid, wrap(p), 0); }
float total(vec4 m) { return m.x + m.y + m.z + m.w; }
int owner(vec4 m) {
  int s = 0;
  float b = m.x;
  if (m.y > b) { s = 1; b = m.y; }
  if (m.z > b) { s = 2; b = m.z; }
  if (m.w > b) { s = 3; }
  return s;
}
`;

// Each species' net sees its own mass channel first, so genomes work in any slot.
export const STEP = `${HEAD}
const float GROW = 0.06, DECAY = 0.004, STARVE = 0.08, DIFFUSE = 0.06, EAT = 0.004, REGEN = 0.002;
uniform sampler2D u_w;
uniform vec4 u_growth;
uniform vec4 u_upkeep;
uniform float u_seed;
layout(location = 0) out vec4 o_mass;
layout(location = 1) out vec4 o_hid;

vec4 rot(vec4 v, int s) { return s == 0 ? v : s == 1 ? v.yzwx : s == 2 ? v.zwxy : v.wxyz; }
vec4 unrot(vec4 v, int s) { return s == 0 ? v : s == 1 ? v.wxyz : s == 2 ? v.zwxy : v.yzwx; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + u_seed) * 43758.5453); }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 nm[9], nh[9];
  vec4 sum = vec4(0.0);
  float alive = 0.0;
  for (int i = 0; i < 9; i++) {
    ivec2 q = p + ivec2(i % 3 - 1, i / 3 - 1);
    nm[i] = M(q); nh[i] = H(q);
    sum += nm[i];
    alive = max(alive, total(nm[i]));
  }
  vec4 m = nm[4], h = nh[4];
  // h.w is food depletion, not a free hidden channel: it persists (and slowly
  // recovers) in dead cells so colonies must keep moving to fresh ground.
  float dep = h.w * (1.0 - REGEN);
  if (alive < 0.03) { o_mass = vec4(0.0); o_hid = vec4(0.0, 0.0, 0.0, dep); return; }

  int s = total(m) > 0.03 ? owner(m) : owner(sum);
  vec4 sxm = (nm[2] + 2.0 * nm[5] + nm[8]) - (nm[0] + 2.0 * nm[3] + nm[6]);
  vec4 sym = (nm[6] + 2.0 * nm[7] + nm[8]) - (nm[0] + 2.0 * nm[1] + nm[2]);
  vec4 sxh = (nh[2] + 2.0 * nh[5] + nh[8]) - (nh[0] + 2.0 * nh[3] + nh[6]);
  vec4 syh = (nh[6] + 2.0 * nh[7] + nh[8]) - (nh[0] + 2.0 * nh[1] + nh[2]);
  vec4 x[6] = vec4[6](rot(m, s), h, rot(sxm, s) * 0.25, sxh * 0.25, rot(sym, s) * 0.25, syh * 0.25);

  int row = s;
  float hid[32];
  for (int j = 0; j < 32; j++) {
    float a = texelFetch(u_w, ivec2(192 + j / 4, row), 0)[j % 4];
    for (int q = 0; q < 6; q++) a += dot(texelFetch(u_w, ivec2(j * 6 + q, row), 0), x[q]);
    hid[j] = max(a, 0.0);
  }
  float y[8];
  for (int o = 0; o < 8; o++) {
    y[o] = texelFetch(u_w, ivec2(264 + o / 4, row), 0)[o % 4];
    for (int j = 0; j < 32; j += 4)
      y[o] += dot(texelFetch(u_w, ivec2(200 + o * 8 + j / 4, row), 0), vec4(hid[j], hid[j + 1], hid[j + 2], hid[j + 3]));
  }
  vec4 om = vec4(y[0], y[1], y[2], y[3]), oh = vec4(y[4], y[5], y[6], y[7]);
  om = tanh(om);
  float fire = step(hash(vec2(p)), 0.5);

  // Physics the nets can't override: diffusion, metabolic decay, a shared
  // carrying capacity, and growth throttled by the global budget (u_growth).
  vec4 lap = (sum - 9.0 * m) / 8.0;
  vec4 own = unrot(vec4(1.0, 0.0, 0.0, 0.0), s);
  vec4 attack = unrot(vec4(0.0, max(om.yzw, 0.0)), s);
  float grow = u_growth[s] * GROW * (1.0 + om.x) * dot(m, own) * (1.0 - total(m)) * (1.0 - h.w);
  float effort = dot(attack, m);
  vec4 dm = own * (grow - 0.02 * effort) - 0.08 * attack * m;
  vec4 starve = DECAY * u_upkeep + STARVE * pow(h.w, 4.0);
  m += DIFFUSE * lap - starve * m + dm * fire * 2.0;
  m = max(m, 0.0);
  float t = total(m);
  if (t > 1.0) m /= t;
  o_mass = m;
  o_hid = vec4(clamp(h.xyz + tanh(oh.xyz) * 0.25 * fire, -1.0, 1.0), min(dep + EAT * t, 1.0));
}`;

export const STATS = `${HEAD}
uniform int u_block;
out vec4 o;
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * u_block;
  vec4 c = vec4(0.0);
  for (int y = 0; y < u_block; y++)
    for (int x = 0; x < u_block; x++) {
      vec4 m = M(base + ivec2(x, y));
      if (total(m) > 0.1) c[owner(m)] += 1.0;
    }
  o = c;
}`;

// Paint: erase (u_species < 0) or seed one species in a disc; u_keep scales channels globally.
export const PAINT = `${HEAD}
uniform vec2 u_at;
uniform float u_radius;
uniform int u_species;
uniform vec4 u_keep;
layout(location = 0) out vec4 o_mass;
layout(location = 1) out vec4 o_hid;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 n = vec2(textureSize(u_mass, 0));
  vec2 d = abs(gl_FragCoord.xy - u_at);
  d = min(d, n - d);
  vec4 m = M(p) * u_keep, h = H(p);
  if (length(d) < u_radius) {
    m = vec4(0.0);
    h = vec4(0.0);
    if (u_species >= 0) m[u_species] = 0.9;
  }
  o_mass = m;
  o_hid = h;
}`;

// Halftone glyphs: one mark per cell, sized by mass; species are legend
// symbols (dot, plus, ring, cross) rather than hues.
export const DRAW = `${HEAD}
uniform vec3 u_colors[4];
uniform float u_cell;
uniform vec2 u_offset;
uniform float u_height;
out vec4 o;
float bar(vec2 l, float r, float t) { return max(min(abs(l.x), abs(l.y)) - t, max(abs(l.x), abs(l.y)) - r); }
void main() {
  vec2 c = (vec2(gl_FragCoord.x, u_height - gl_FragCoord.y) - u_offset) / u_cell;
  vec2 l = fract(c) - 0.5;
  vec4 m = M(ivec2(floor(c)));
  int s = owner(m);
  float r = 0.36 * sqrt(smoothstep(0.05, 0.8, m[s]));
  float t = max(0.05, 0.6 / u_cell);
  float d = s == 0 ? length(l) - r * 0.55
          : s == 1 ? bar(l, r, t)
          : s == 2 ? abs(length(l) - r * 0.7) - t
          : bar(mat2(0.7071, 0.7071, -0.7071, 0.7071) * l, r * 0.9, t);
  float a = r < 0.03 ? 0.0 : 1.0 - smoothstep(-0.5, 0.5, d * u_cell);
  o = vec4(u_colors[s] * a, a);
}`;
