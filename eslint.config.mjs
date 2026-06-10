import eslint from "@eslint/js";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    plugins: {
      "@eslint-community/eslint-comments": eslintComments,
      obsidianmd,
    },
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-this-alias": 0,
      "@typescript-eslint/await-thenable": "warn",
      "@typescript-eslint/no-explicit-any": ["warn", { fixToUnknown: true }],
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
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
      "obsidianmd/no-plugin-as-component": "error",
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/prefer-active-doc": "warn",
      "obsidianmd/prefer-instanceof": "warn",
      "obsidianmd/prefer-window-timers": "warn",
      "obsidianmd/commands/no-default-hotkeys": "warn",
    },
  },
);
