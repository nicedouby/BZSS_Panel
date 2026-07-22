import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runTsc } = require("@volar/typescript/lib/quickstart/runTsc");
const vue = require("@vue/language-core");
const tscPath = require.resolve("typescript/lib/tsc");
const windowsPathReg = /\\/g;

// @volar/typescript normally injects this object into the transformed
// TypeScript compiler:
//
//   new Proxy({}, { get(_, name) { return eval(name); } })
//
// That eval-based bridge is incompatible with Node's
// --disallow-code-generation-from-strings. The transformed compiler only
// needs TypeScript's public API here, while its private createProgram remains
// in the transformed compiler module. Passing require("typescript") removes
// the eval bridge without changing NODE_OPTIONS or weakening Node security.
const typescriptObject = 'require("typescript")';

let runExtensions = [".vue"];
const extensionsChangedException = new Error("extensions changed");

const main = () => runTsc(
  tscPath,
  runExtensions,
  (ts, options) => {
    const { configFilePath } = options.options;
    const vueOptions = typeof configFilePath === "string"
      ? vue.createParsedCommandLine(
        ts,
        ts.sys,
        configFilePath.replace(windowsPathReg, "/"),
      ).vueOptions
      : vue.getDefaultCompilerOptions();
    const allExtensions = vue.getAllExtensions(vueOptions);

    if (
      runExtensions.length === allExtensions.length
      && runExtensions.every((extension) => allExtensions.includes(extension))
    ) {
      const vueLanguagePlugin = vue.createVueLanguagePlugin(
        ts,
        options.options,
        vueOptions,
        (id) => id,
      );
      return { languagePlugins: [vueLanguagePlugin] };
    }

    runExtensions = allExtensions;
    throw extensionsChangedException;
  },
  typescriptObject,
);

try {
  main();
} catch (error) {
  if (error === extensionsChangedException) {
    main();
  } else {
    throw error;
  }
}
