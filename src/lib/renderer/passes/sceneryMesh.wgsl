// Instanced static-mesh scenery pass. Draws GLB-loaded meshes (course
// furniture, structures, …) at per-instance mat4 transforms. The per-mesh
// base colour comes from the GLB material; sun shade from the frame uniform.

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

struct MeshUniforms {
  baseColor: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> mesh: MeshUniforms;
// Per-instance mat4 (column-major, 4 × vec4).
@group(1) @binding(1) var<storage, read> instances: array<mat4x4<f32>>;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
};

struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) worldNormal: vec3<f32>,
  @location(1) worldDist: f32,
};

@vertex
fn vs_main(in: VsIn, @builtin(instance_index) ii: u32) -> VsOut {
  let model = instances[ii];
  let world = model * vec4<f32>(in.position, 1.0);
  let n = (model * vec4<f32>(in.normal, 0.0)).xyz;

  var out: VsOut;
  out.clip = frame.viewProj * world;
  out.worldNormal = normalize(n);
  let d = world.xyz - frame.camPos;
  out.worldDist = length(vec3<f32>(d.x, 0.0, d.z));
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let sun = normalize(frame.sunDir);
  let n = normalize(in.worldNormal);
  let diffuse = max(dot(n, sun), 0.0);
  let shade = 0.35 + 0.65 * diffuse;
  let col = mesh.baseColor.rgb * shade;
  // Fog with the frame's exponential density.
  let density = frame.fog.x + frame.fog.y * in.worldDist;
  let f = clamp(1.0 - exp(-density * in.worldDist), 0.0, 1.0);
  let fogCol = vec3<f32>(0.72, 0.78, 0.82);
  return vec4<f32>(mix(col, fogCol, f), mesh.baseColor.a);
}
