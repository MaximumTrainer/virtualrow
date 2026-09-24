// The billboard foliage's own lines: wind, and a tint a tree (#333, #341).
//
// Vertex chunks follow `#include <begin_vertex>`; the fragment chunk follows
// `#include <color_fragment>`. No placeholders - nothing here is computed
// per material.

// @chunk:vertexDeclarations
uniform float uTime;
varying float vFoliageTint;

// @chunk:sway
// The wind, in the tree's own space before its instance transform.
//
// Phased by where the tree stands so a bank does not sway in step, and scaled
// by `uv.y` - zero at the ground, one at the crown - so the trunk stays
// planted. The amplitude is a fraction of the tree's height, because the
// instance matrix scales it with everything else: three centimetres of sway a
// metre of tree, a third of a metre at the top of a twelve-metre oak.
float sway = sin(uTime * 1.3 + instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.4) * 0.03 * uv.y;
transformed.x += sway; transformed.z += sway * 0.6;

// @chunk:tint
// One tint a tree, from a hash of where it stands, in 0.82-1.18.
//
// Every tree of a species otherwise shares one colour exactly, and a bank of
// identical greens reads as wallpaper. A per-instance colour attribute would
// have to be compacted alongside the matrices each time the cull runs; hashed
// from the matrix, the tint travels with it for nothing.
vFoliageTint = 0.82 + 0.36 * fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);

// @chunk:fragmentDeclarations
varying float vFoliageTint;

// @chunk:tintFragment
diffuseColor.rgb *= vFoliageTint;
