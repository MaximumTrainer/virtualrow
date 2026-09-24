// The Gerstner swell that displaces the water surface (#324, #341).
//
// Three chunks, injected into three's own vertex shader: the functions go
// above it, and the other two replace `#include <beginnormal_vertex>` and
// `#include <begin_vertex>`. They are marked rather than split by position so
// the file reads as one shader, which is what it is.
//
// The placeholders are filled by `gerstnerChunks` in `shaderChunks.ts`:
//
//   WAVE_XY              where the wave is sampled, in the mesh's own axes
//   NORMAL_FROM_GRADIENT the normal, pointing up whichever axis displaces
//   HEIGHT_DISPLACE      the displaced position
//   AMP0..3 / FREQ0..3   the swell, as amplitudes in metres and frequencies
//
// Anything not a placeholder is the shader as it ships. A typo here is caught
// by `shaders.test.ts`, which assembles each chunk into a complete shader and
// parses it - rather than by a rower's GPU refusing to compile it.

// @chunk:functions
uniform float uTime;
float gWave(vec2 p, vec2 dir, float amp, float freq, float spd) {
  vec2 nd = normalize(dir);
  return amp * sin(dot(nd, p) * freq - spd * uTime);
}
vec2 gWaveGrad(vec2 p, vec2 dir, float amp, float freq, float spd) {
  vec2 nd = normalize(dir);
  return amp * freq * nd * cos(dot(nd, p) * freq - spd * uTime);
}

// @chunk:normal
vec2 wXY = WAVE_XY;
vec2 wGrad = gWaveGrad(wXY, vec2( 1.0,  0.3), AMP0, FREQ0, 0.80)
           + gWaveGrad(wXY, vec2(-0.3,  1.0), AMP1, FREQ1, 0.60)
           + gWaveGrad(wXY, vec2( 0.7,  0.7), AMP2, FREQ2, 1.10)
           + gWaveGrad(wXY, vec2( 0.5, -0.5), AMP3, FREQ3, 1.50);
vec3 objectNormal = normalize(NORMAL_FROM_GRADIENT);
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif

// @chunk:position
float wH = gWave(wXY, vec2( 1.0,  0.3), AMP0, FREQ0, 0.80)
         + gWave(wXY, vec2(-0.3,  1.0), AMP1, FREQ1, 0.60)
         + gWave(wXY, vec2( 0.7,  0.7), AMP2, FREQ2, 1.10)
         + gWave(wXY, vec2( 0.5, -0.5), AMP3, FREQ3, 1.50);
vec3 transformed = HEIGHT_DISPLACE;
