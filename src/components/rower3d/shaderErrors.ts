/**
 * How many shaders the GPU refused to compile (#341).
 *
 * `shaders.test.ts` parses the chunks this scene injects, which catches GLSL
 * that is not GLSL. It cannot catch what only a driver knows: a `varying` the
 * fragment shader declares and the vertex shader does not, a built-in that
 * exists in one GLSL version and not the next, a uniform three renamed. Those
 * still reach a rower, and they arrive as a silent black scene - three logs
 * the compile failure to the console and carries on.
 *
 * So the count is published, and a spec can assert it is zero. Zero is the only
 * acceptable number: a shader that does not compile is not a degraded scene, it
 * is a missing one.
 *
 * Behind the test flag, like the rest of the automation scaffolding. A rower's
 * browser does not need a counter, and wrapping `getShaderParameter` on every
 * context in the wild is not a cost worth paying for telemetry nobody reads.
 */

/** The WebGL entry points this needs; a `Pick` so a fake is a plain object. */
type ShaderCompiling = Pick<
  WebGLRenderingContext,
  'getShaderParameter' | 'getShaderInfoLog' | 'COMPILE_STATUS'
>;

/**
 * Count every shader this context fails to compile.
 *
 * Wraps `getShaderParameter` rather than `compileShader`, because compiling is
 * asynchronous on every driver worth the name: `compileShader` returns
 * immediately and the answer arrives when someone asks for `COMPILE_STATUS`.
 * That call is the moment the failure becomes knowable, and three always makes
 * it.
 *
 * Returns the wrapped context so a caller can hand it on; it is mutated in
 * place, which is what three will be holding.
 */
export const countShaderErrors = <T extends ShaderCompiling>(
  gl: T,
  onError: (log: string) => void,
): T => {
  const original = gl.getShaderParameter.bind(gl);

  gl.getShaderParameter = function patched(shader: WebGLShader, pname: number) {
    const value = original(shader, pname);
    if (pname === gl.COMPILE_STATUS && value === false) {
      onError(gl.getShaderInfoLog(shader) ?? 'shader failed to compile, with no log');
    }
    return value;
  } as T['getShaderParameter'];

  return gl;
};
