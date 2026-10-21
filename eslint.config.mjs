import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/drizzle/**",
      "**/next-env.d.ts",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.jest },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/*.cjs", "**/*.js", "**/*.mjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Isolation rule: the two systems must never reach into each other's database code.
    files: ["apps/gym-api/**/*.ts", "apps/gym-web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["**/property-api/**", "**/property-web/**", "@platform/property-*"], message: "System B must not import System A code." }] },
      ],
    },
  },
  {
    files: ["apps/property-api/**/*.ts", "apps/property-web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["**/gym-api/**", "**/gym-web/**", "@platform/gym-*"], message: "System A must not import System B code." }] },
      ],
    },
  },
);
