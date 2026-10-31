/**
 * `.glsl` files are imported as source, not compiled by Vite (#341).
 *
 * `?raw` is Vite's own suffix for "give me the file as a string"; the shaders
 * are then spliced into three's own vertex and fragment shaders at
 * `onBeforeCompile`, which is the only thing that can compile them.
 */
declare module '*.glsl?raw' {
  const source: string;
  export default source;
}
