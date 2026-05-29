import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["packages/*/src/**/*.test.ts", "packages/*/src/**/*.test.tsx"],
		exclude: [
			"packages/*/src/**/*.integration.test.ts",
			// TODO(release): ink-testing-library@4 + react-reconciler@0.29 +
			// react@19 collide on `ReactCurrentOwner` at import time. Failure:
			//   TypeError: Cannot read properties of undefined (reading 'ReactCurrentOwner')
			//     at react-reconciler/cjs/react-reconciler.development.js:491
			// Un-skip once Ink ships a React-19-compatible reconciler.
			"packages/ui/src/tui/introspect/DashboardApp.test.tsx",
		],
		environment: "node",
		globals: true,
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			include: ["packages/*/src/**/*.ts"],
			exclude: [
				"packages/*/src/**/*.test.ts",
				"packages/*/src/**/*.integration.test.ts",
			],
		},
		reporters: ["verbose"],
		stdout: true,
		silent: false,
		testTimeout: 10000,
		diffLimit: 10000,
		pool: "threads",
		poolOptions: {
			threads: {
				singleThread: true,
			},
		},
	},
	define: {
		"process.env": process.env,
	},
});
