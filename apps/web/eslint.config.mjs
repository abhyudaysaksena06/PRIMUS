import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The /demo walkthrough (from TushKum's Final-Frontend branch) runs on sample data only. It is kept as written, so
  // these two rules warn there instead of failing the build; the real app keeps them as errors.
  {
    files: ["app/demo/**"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react/jsx-no-comment-textnodes": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
