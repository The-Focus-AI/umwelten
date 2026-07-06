/**
 * GitHub App config resolution — feature is off (null) unless all three
 * env vars are present; the private key is a file path, never contents.
 */

import { describe, it, expect } from "vitest";
import { resolveGithubAppConfig } from "./app-config.js";

const FULL_ENV = {
	GITHUB_APP_ID: "12345",
	GITHUB_APP_INSTALLATION_ID: "9876",
	GITHUB_APP_PRIVATE_KEY_FILE: "/etc/gaia/github-app.pem",
};

describe("resolveGithubAppConfig", () => {
	it("resolves all three values when set", () => {
		expect(resolveGithubAppConfig(FULL_ENV)).toEqual({
			appId: "12345",
			installationId: "9876",
			privateKeyFile: "/etc/gaia/github-app.pem",
		});
	});

	it("trims whitespace", () => {
		expect(
			resolveGithubAppConfig({
				GITHUB_APP_ID: " 12345 ",
				GITHUB_APP_INSTALLATION_ID: "9876\n",
				GITHUB_APP_PRIVATE_KEY_FILE: " /key.pem ",
			}),
		).toEqual({
			appId: "12345",
			installationId: "9876",
			privateKeyFile: "/key.pem",
		});
	});

	it("returns null when nothing is set (feature off)", () => {
		expect(resolveGithubAppConfig({})).toBeNull();
	});

	it.each([
		"GITHUB_APP_ID",
		"GITHUB_APP_INSTALLATION_ID",
		"GITHUB_APP_PRIVATE_KEY_FILE",
	])("returns null when %s is missing", (missing) => {
		const env: Record<string, string | undefined> = { ...FULL_ENV };
		delete env[missing];
		expect(resolveGithubAppConfig(env)).toBeNull();
	});

	it("treats blank values as unset", () => {
		expect(
			resolveGithubAppConfig({ ...FULL_ENV, GITHUB_APP_ID: "   " }),
		).toBeNull();
	});
});
