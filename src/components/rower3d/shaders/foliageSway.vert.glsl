// The older per-vertex sway, on the kit's GLB foliage (#107, #341).
//
// Follows `#include <begin_vertex>`. Unlike the billboards this has no
// instance matrix to phase by, so it uses the vertex's own x.

// @chunk:declarations
uniform float uTime;

// @chunk:sway
float swayAmt = sin(uTime * 1.2 + position.x * 0.5) * 0.04 * max(0.0, position.y / 5.0);
transformed.x += swayAmt;
transformed.z += swayAmt * 0.7;
