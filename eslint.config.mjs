import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "*.config.*",
      "sentry.*.config.ts",
      "instrumentation*.ts",
      "emails/**",
      "tests/**",
    ],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript type-checked rules
  ...tseslint.configs.recommendedTypeChecked,

  // TypeScript parser options (applied to all TS/TSX files)
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Next.js plugin rules
  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },

  // React hooks rules
  {
    plugins: {
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Project-specific rule overrides
  {
    rules: {
      // --- Bug catchers (errors) ---
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } }, // Allow async onClick handlers
      ],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-explicit-any": "warn",

      // --- Dead code detection ---
      "no-unused-vars": "off", // Use TS version instead
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],

      // --- Console hygiene (CONVENTIONS.md: no console.log artifacts) ---
      "no-console": ["warn", { allow: ["warn", "error", "info", "debug"] }],

      // --- Relax rules that generate noise, not bugs ---
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-base-to-string": "off",
    },
  },

  // React components/pages: downgrade floating promises to warn
  // (useEffect fire-and-forget pattern is intentional when try/catch is inside)
  {
    files: ["app/**/*.tsx", "components/**/*.tsx", "hooks/**/*.ts", "contexts/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-floating-promises": "warn",
    },
  },

  // Test files: relax rules
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "__tests__/**/*", "tests/**/*"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },

  // Disable type-checked rules for JS files (they can't be type-checked)
  {
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  }
);
