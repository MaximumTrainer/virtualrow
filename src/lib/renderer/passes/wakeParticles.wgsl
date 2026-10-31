// Hull wake particles (#571). Instanced camera-facing billboards: one
// `WakeInstance` per particle in the pool, six verts per instance built
// from a static CORNERS array. Fragment shader paints a soft disc with
// a lifetime-driven alpha fade; the whole quad is additive against the
// scene so the foam reads over whatever colour the water carries.

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

// Six floats per particle: (x, y, z, age, lifetime, size). A storage
// buffer lets the vertex shader read each particle via `instance_index`.
@group(2) @binding(0) var<storage, read> particles: array<vec4<f32>>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) lifeFrac: f32,
};

// Six verts form two triangles over the unit quad [-1, 1] in local space.
const CORNERS = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0),
  vec2<f32>( 1.0, -1.0),
  vec2<f32>(-1.0,  1.0),
  vec2<f32>( 1.0, -1.0),
  vec2<f32>( 1.0,  1.0),
  vec2<f32>(-1.0,  1.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  // 6 floats per particle packed into 1.5 vec4s — the storage buffer
  // view-cast groups them as 2 vec4<f32> per instance (idxA = ii*2,
  // idxB = ii*2 + 1). First vec4: (x, y, z, age). Second: (lifetime,
  // size, _, _). The CPU uploader emits them exactly in that order.
  let idxA = ii * 2u;
  let idxB = idxA + 1u;
  let a = particles[idxA];
  let b = particles[idxB];
  let worldC = vec3<f32>(a.x, a.y, a.z);
  let age = a.w;
  let lifetime = b.x;
  let size = b.y;

  // Dead particles collapse to zero so they're invisible without a CPU
  // compact — avoids a per-frame GPU-upload shrink.
  let dead = lifetime <= 0.0 || age >= lifetime;
  let lifeFrac = select(age / max(lifetime, 1e-5), 1.0, dead);

  // Scale up with age so the foam fans out behind the hull.
  let scaleEnd = 1.9;
  let liveScale = size * mix(0.6, scaleEnd, lifeFrac);
  let scale = select(liveScale, 0.0, dead);

  let corner = CORNERS[vi];
  // Build the quad in view space so it always faces the camera.
  let viewCentre = (frame.view * vec4<f32>(worldC, 1.0)).xyz;
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
  // Soft circular alpha: `r` is 0 at the quad centre, 1 at the edges.
  let r = length(in.local);
  let shape = clamp(1.0 - r * r, 0.0, 1.0);
  // Fade quickly in from 0 (particle just spawned, boat still over it)
  // then out across the rest of the life. Peak ~15% through.
  let fadeIn = smoothstep(0.0, 0.15, in.lifeFrac);
  let fadeOut = 1.0 - smoothstep(0.4, 1.0, in.lifeFrac);
  let alpha = shape * fadeIn * fadeOut * 0.65;
  // Foam colour: a cool-tinted white; sun direction nudges warmth so the
  // wake under morning light doesn't look lifeless.
  let sunWarm = max(normalize(frame.sunDir).y, 0.0) * 0.08;
  let col = vec3<f32>(0.92 + sunWarm, 0.94, 0.98);
  return vec4<f32>(col * alpha, alpha);
}
