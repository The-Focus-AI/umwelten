#!/usr/bin/env node
/**
 * Smoke test for the CredentialCatalog — no API keys or Docker needed.
 * Run: pnpm exec tsx scripts/smoke-test-credentials.ts
 */
import { CredentialCatalog } from "../packages/habitat/src/gaia/credential-catalog.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dataDir = mkdtempSync(join(tmpdir(), "cred-smoke-"));
const catalog = new CredentialCatalog(dataDir);
let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
	if (cond) {
		passed++;
		console.log(`  ✅ ${label}`);
	} else {
		failed++;
		console.log(`  ❌ ${label}`);
	}
}

async function run() {
	await catalog.load();
	console.log("\n🔑 Credential Catalog Smoke Test\n");

	// --- add ---
	console.log("add:");
	try {
		await catalog.add({
			name: "quickbooks-read-key",
			label: "QuickBooks Read-Only",
			provider: "intuit/quickbooks",
			capabilities: ["quickbooks:read", "quickbooks:reports"],
			scopes: ["accounts:read"],
			dashboardUrl: "https://developer.intuit.com/app/developer/dashboard",
			sourceVaultRef: "op://Focus.AI/quickbooks-read-key",
			status: "unknown",
		});
		assert(true, "added quickbooks-read-key");
	} catch (e: any) {
		assert(false, `add failed: ${e.message}`);
	}

	try {
		await catalog.add({
			name: "github-bot-token",
			label: "GitHub Bot Token",
			provider: "github",
			capabilities: ["github:read", "github:write", "github:issues"],
			scopes: ["repo", "read:org"],
			status: "unknown",
		});
		assert(true, "added github-bot-token");
	} catch (e: any) {
		assert(false, `add failed: ${e.message}`);
	}

	try {
		await catalog.add({
			name: "openrouter-api-key",
			label: "OpenRouter API Key",
			provider: "openrouter",
			capabilities: ["llm:generate"],
			scopes: [],
			status: "active",
			lastVerified: new Date().toISOString(),
		});
		assert(true, "added openrouter-api-key");
	} catch (e: any) {
		assert(false, `add failed: ${e.message}`);
	}

	// --- duplicate rejection ---
	console.log("\nduplicate rejection:");
	try {
		await catalog.add({
			name: "quickbooks-read-key",
			label: "dup",
			provider: "x",
			capabilities: [],
			scopes: [],
			status: "unknown",
		});
		assert(false, "should have rejected duplicate");
	} catch {
		assert(true, "rejected duplicate name");
	}

	// --- list ---
	console.log("\nlist:");
	const all = catalog.list();
	assert(all.length === 3, `list returns 3 entries (got ${all.length})`);

	// --- get ---
	console.log("\nget:");
	const gh = catalog.get("github-bot-token");
	assert(gh?.provider === "github", "get by name works");
	assert(catalog.get("nope") === undefined, "get missing returns undefined");

	// --- listByCapability ---
	console.log("\nlistByCapability:");
	const readers = catalog.listByCapability("github:read");
	assert(
		readers.length === 1,
		`1 entry has github:read (got ${readers.length})`,
	);

	const llm = catalog.listByCapability("llm:generate");
	assert(llm.length === 1, `1 entry has llm:generate (got ${llm.length})`);

	assert(
		catalog.listByCapability("nonexistent").length === 0,
		"unmatched capability returns empty",
	);

	// --- listByProvider ---
	console.log("\nlistByProvider:");
	assert(catalog.listByProvider("github").length === 1, "1 github entry");
	assert(
		catalog.listByProvider("openrouter").length === 1,
		"1 openrouter entry",
	);
	assert(
		catalog.listByProvider("intuit/quickbooks").length === 1,
		"1 quickbooks entry",
	);
	assert(catalog.listByProvider("stripe").length === 0, "0 stripe entries");

	// --- verify ---
	console.log("\nverify:");
	const before = catalog.get("quickbooks-read-key");
	assert(before?.status === "unknown", "status starts unknown");

	const v = await catalog.verify("quickbooks-read-key");
	assert(v?.status === "active", "verify sets status to active");
	assert(v?.lastVerified !== undefined, "verify sets lastVerified");

	assert(
		(await catalog.verify("nope")) === undefined,
		"verify missing returns undefined",
	);

	// --- remove ---
	console.log("\nremove:");
	assert(
		await catalog.remove("openrouter-api-key"),
		"removed openrouter-api-key",
	);
	assert(catalog.list().length === 2, "2 entries remain");
	assert(
		!(await catalog.remove("already-gone")),
		"remove missing returns false",
	);

	// --- persistence ---
	console.log("\npersistence:");
	const catalog2 = new CredentialCatalog(dataDir);
	await catalog2.load();
	assert(catalog2.list().length === 2, "reloaded catalog has 2 entries");

	// --- secret safety ---
	console.log("\nsecret safety:");
	const fs = await import("node:fs/promises");
	const raw = await fs.readFile(join(dataDir, "credentials.json"), "utf-8");
	const parsed = JSON.parse(raw);
	const hasNoSecrets = parsed.every(
		(e: any) =>
			!("value" in e) &&
			!("secret" in e) &&
			!("key" in e) &&
			!("token" in e) &&
			!("apiKey" in e),
	);
	assert(hasNoSecrets, "credentials.json contains no secret values");

	// --- cleanup ---
	rmSync(dataDir, { recursive: true, force: true });

	console.log(`\n${"─".repeat(40)}`);
	console.log(`Results: ${passed} passed, ${failed} failed`);
	process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
	console.error(e);
	process.exit(1);
});
