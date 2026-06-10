import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import typescript from "@rollup/plugin-typescript";
import fs from "node:fs";

export default (commandLineArgs) => {
  const isWatch = Boolean(commandLineArgs.watch);

  return {
    input: commandLineArgs.configWithTests
      ? "src/ObsidianBulletPluginWithTests.ts"
      : "src/ObsidianBulletPlugin.ts",
    output: {
      file: "dist/main.js",
      sourcemap: isWatch ? "inline" : false,
      format: "cjs",
      exports: "default",
    },
    external: [
      "obsidian",
      "codemirror",
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
    ],
    plugins: [
      replace({
        preventAssignment: true,
        PLUGIN_VERSION: JSON.stringify(
          JSON.parse(fs.readFileSync("./package.json", "utf-8")).version,
        ),
      }),
      typescript(),
      nodeResolve({ browser: true }),
      commonjs(),
    ],
  };
};
