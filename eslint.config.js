import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "out/",
    "dist/",
    "release/",
    "resources/",
    "test-results/",
    "playwright-report/",
    "e2e-artifacts/",
    ".workflow/",
    "billing/dist/",
    "billing/.wrangler/",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    files: ["renderer/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["website/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["billing/src/**/*.ts"],
    languageOptions: { globals: globals.worker },
  },
  {
    files: ["billing/tests/**/*.{ts,mjs}", "billing/*.{ts,js,mjs}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: [
      "main/**/*.ts",
      "electron/**/*.ts",
      "shared/**/*.ts",
      "tests/**/*.mjs",
      "scripts/**/*.mjs",
      "e2e/**/*.ts",
      "*.{js,ts}",
    ],
    languageOptions: { globals: globals.node },
  },
);
