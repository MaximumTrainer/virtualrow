// Oar-blade splash particles (#571). Instanced camera-facing billboards —
// same storage layout as wake particles but each particle carries a
// per-particle (vx, vz) that the vertex shader uses to arc the splash
// outward from the blade over its short life. Gravity is applied in-
// shader so there's no CPU per-frame vy update.
//
// Burst-fed by `engine/oarSplashParticles.ts` at the catch and finish
// of each stroke; the storage buffer is uploaded whole each frame.

struct Frame {
  view: mat4x4<f32>,
  proj: mat4x4<f32>,
  viewProj: mat4x4<f32>,
  camPos: vec3<f32>,
  _pad0: f32,
  sunDir: vec3<f32>,
  _pad1: f32,
  fog: vec4<f32>,
  time: f32,
  _pad2: vec3<f32>,
};
@group(0) @binding(0) var<uniform> frame: Frame;

// Each particle is stored as two vec4<f32>:
//   particles[ii*2]     = (x, y, z, age)
//   particles[ii*2 + 1] = (lifetime, size, vx, vz)
@group(2) @binding(0) var<storage, read> particles: array<vec4<f32>>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) lifeFrac: f32,
};

const CORNERS = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0),
  vec2<f32>( 1.0, -1.0),
  vec2<f32>(-1.0,  1.0),
  vec2<f32>( 1.0, -1.0),
  vec2<f32>( 1.0,  1.0),
  vec2<f32>(-1.0,  1.0),
);

// Gravity drag + initial upward kick: a splash leaves the blade going
// mostly upward and outward, peaks ~0.15 s in, then falls back toward
// the water. Values picked so the arc tops out around 0.4 m above the
// water surface for a 0.6 s lifetime, which reads clearly from the
// chase camera without covering the hull.
const INITIAL_UP: f32 = 2.6;      // m/s
const GRAVITY: f32 = -9.8;        // m/s² (world +Y is up)

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let a = particles[ii * 2u];
  let b = particles[ii * 2u + 1u];
  let origin = vec3<f32>(a.x, a.y, a.z);
  let age = a.w;
  let lifetime = b.x;
  let size = b.y;
  let vx = b.z;
  let vz = b.w;

  let dead = lifetime <= 0.0 || age >= lifetime;
  let lifeFrac = select(age / max(lifetime, 1e-5), 1.0, dead);

  // Arc the particle under gravity. x and z integrate linearly with the
  // stored (vx, vz); y is a ballistic parabola from INITIAL_UP.
  let dx = vx * age;
  let dz = vz * age;
  let dy = INITIAL_UP * age + 0.5 * GRAVITY * age * age;
  let world = origin + vec3<f32>(dx, dy, dz);

  // Shrink the quad as the particle ages so the plume thins out.
  let liveScale = size * (1.0 - lifeFrac * 0.5);
  let scale = select(liveScale, 0.0, dead);

  let corner = CORNERS[vi];
  let viewCentre = (frame.view * vec4<f32>(world, 1.0)).xyz;
  let viewOffset = vec3<f32>(corner.x * scale, corner.y * scale, 0.0);
  let viewPos = viewCentre + viewOffset;

  var out: VSOut;
  out.pos = frame.proj * vec4<f32>(viewPos, 1.0);
  out.local = corner;
  out.lifeFrac = lifeFrac;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Soft disc with a stronger centre than wake foam so individual drops
  // read as distinct spray rather than a continuous sheet.
  let r = length(in.local);
  let shape = clamp(1.0 - r, 0.0, 1.0);
  let fadeIn = smoothstep(0.0, 0.1, in.lifeFrac);
  let fadeOut = 1.0 - smoothstep(0.4, 1.0, in.lifeFrac);
  let alpha = shape * shape * fadeIn * fadeOut * 0.75;
  let sunWarm = max(normalize(frame.sunDir).y, 0.0) * 0.08;
  let col = vec3<f32>(0.94 + sunWarm, 0.95, 0.98);
  return vec4<f32>(col * alpha, alpha);
}
