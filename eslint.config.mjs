import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import eslint from "@eslint/js";
import noUnsanitized from "eslint-plugin-no-unsanitized";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    plugins: {
      "@eslint-community/eslint-comments": eslintComments,
      obsidianmd,
      "no-unsanitized": noUnsanitized,
    },
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-this-alias": "error",
      "@typescript-eslint/no-deprecated": "warn",
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "obsidianmd/no-unsupported-api": "error",
      "@typescript-eslint/await-thenable": "warn",
      "@typescript-eslint/no-explicit-any": ["warn", { fixToUnknown: true }],
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "warn",
      "@eslint-community/eslint-comments/disable-enable-pair": [
        "error",
        { allowWholeFile: false },
      ],
      "@eslint-community/eslint-comments/no-restricted-disable": [
        "error",
        "@typescript-eslint/no-explicit-any",
      ],
      "@eslint-community/eslint-comments/require-description": "error",
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/regex-lookbehind": "error",
      "obsidianmd/no-global-this": "warn",
      "obsidianmd/prefer-active-doc": "warn",
      "obsidianmd/prefer-create-el": "warn",
      "obsidianmd/prefer-instanceof": "warn",
      "obsidianmd/prefer-window-timers": "warn",
      "obsidianmd/commands/no-default-hotkeys": "warn",
      "obsidianmd/settings-tab/prefer-setting-definitions": "warn",
      "obsidianmd/settings-tab/require-display": "warn",
      "no-console": ["warn", { allow: ["warn", "error", "debug"] }],
    },
  },
  {
    files: ["src/**/__tests__/**/*.ts"],
    rules: {
      "obsidianmd/no-global-this": "off",
    },
  },
);
