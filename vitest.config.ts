import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: [
			"packages/*/src/**/*.test.ts",
			"packages/*/src/**/*.test.tsx",
			// Deployable example agents that ship their own tested deep modules
			// (kept out of the library packages, but still run in the default suite).
			"examples/twitter-habitat/**/*.test.ts",
		],
		exclude: [
			"packages/*/src/**/*.integration.test.ts",
			"**/node_modules/**",
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
