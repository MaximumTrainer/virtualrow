// The wgsl_reflect npm package ships typings under its root entry
// (`import 'wgsl_reflect'`), but that entry resolves to a CJS build under
// Node that fails in Vitest with "exports is not defined in ES module
// scope". Importing the ESM subpath directly works at runtime but bypasses
// the package's types, so this declaration shim gives the subpath the
// surface the test actually uses.
declare module 'wgsl_reflect/wgsl_reflect.module.js' {
  interface WgslAttribute {
    name: string;
  }
  interface WgslFunction {
    attributes?: WgslAttribute[];
  }
  export class WgslReflect {
    constructor(src: string);
    functions: WgslFunction[];
  }
}
