import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
	{
		ignores: [
			"**/node_modules/**",
			"**/dist/**",
			"**/build/**",
			"**/.vitepress/cache/**",
			"**/.vitepress/dist/**",
			"docs/.vitepress/dist/**",
			"packages/*/dist/**",
			"examples/**",
			"scripts/**",
			"output/**",
			"reports/**",
		],
	},
	js.configs.recommended,
	{
		files: ["packages/*/src/**/*.{ts,tsx}"],
		languageOptions: {
			parser: tsParser,
			ecmaVersion: 2024,
			sourceType: "module",
			parserOptions: {
				ecmaFeatures: { jsx: true },
			},
		},
		plugins: {
			"@typescript-eslint": tsPlugin,
		},
		rules: {
			...tsPlugin.configs.recommended.rules,
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": [
				"warn",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-require-imports": "warn",
			"@typescript-eslint/triple-slash-reference": "warn",
			"no-undef": "off",
			"no-empty": ["warn", { allowEmptyCatch: true }],
		},
	},
];
