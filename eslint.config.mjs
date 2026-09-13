import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**"],
  },
  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
);
