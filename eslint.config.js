import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri/target", "src-tauri/gen", "node_modules", "test-results", "playwright-report"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "error",
      // Money must never pass through float math in the UI: parseFloat/toFixed round silently
      "no-restricted-globals": ["error", { name: "parseFloat", message: "Use parseMoney() from @/lib/money." }],
      "no-restricted-properties": [
        "error",
        { object: "Number", property: "parseFloat", message: "Use parseMoney() from @/lib/money." },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // shadcn/ui components export their cva variants next to the component by design
    files: ["src/components/ui/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
);
