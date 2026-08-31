import { createHash } from "node:crypto";
import type {
	GaiaHabitatEntry,
	GaiaPublishedPreview,
} from "./types.js";

export const DEFAULT_PREVIEW_DOMAIN = "preview.crepusculardiphthong.com";
const MAX_DNS_LABEL_LENGTH = 63;

function sanitizeLabelPart(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "branch"
	);
}

function shortHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/** One-based ordinals remain stable when process startup order changes. */
export function assignPreviewOrdinals(
	ports: readonly number[],
): Array<{ port: number; ordinal: number }> {
	return [...new Set(ports)]
		.filter((port) => Number.isInteger(port) && port > 0 && port <= 65_535)
		.sort((a, b) => a - b)
		.map((port, index) => ({ port, ordinal: index + 1 }));
}

/** Build the flat DNS label for one branch service (ADR 0035). */
export function previewLabel(
	projectId: string,
	branch: string,
	ordinal: number,
	previewSuffix: string,
): string {
	if (!Number.isInteger(ordinal) || ordinal < 1) {
		throw new Error("Preview ordinal must be a positive integer");
	}

	const project = sanitizeLabelPart(projectId);
	const branchPart = sanitizeLabelPart(branch);
	const suffix = sanitizeLabelPart(previewSuffix);
	const identity = `${project}-${branchPart}`;
	const tail = `-${ordinal}-${suffix}`;
	const available = MAX_DNS_LABEL_LENGTH - tail.length;
	if (available < 10) throw new Error("Preview suffix is too long for a DNS label");

	if (identity.length <= available) return `${identity}${tail}`;

	const hash = shortHash(`${projectId}\0${branch}`);
	const prefixLength = available - hash.length - 1;
	const prefix = identity.slice(0, prefixLength).replace(/-+$/g, "");
	return `${prefix}-${hash}${tail}`;
}

export function previewHostname(
	entry: Pick<GaiaHabitatEntry, "id" | "previewSuffix">,
	preview: Pick<GaiaPublishedPreview, "branch" | "ordinal">,
	domain = DEFAULT_PREVIEW_DOMAIN,
): string {
	if (!entry.previewSuffix) {
		throw new Error(`Habitat "${entry.id}" has no preview suffix`);
	}
	return `${previewLabel(entry.id, preview.branch, preview.ordinal, entry.previewSuffix)}.${domain}`;
}

export type PreviewResolution =
	| {
			kind: "target";
			entry: GaiaHabitatEntry;
			preview: GaiaPublishedPreview;
			hostname: string;
			dormant: boolean;
	  }
	| { kind: "stale"; entry: GaiaHabitatEntry }
	| { kind: "unknown" };

/** Resolve from the persisted cache, including while the container is asleep. */
export function resolvePreviewHostname(
	hostname: string,
	entries: readonly GaiaHabitatEntry[],
	domain = DEFAULT_PREVIEW_DOMAIN,
): PreviewResolution {
	const normalized = hostname.toLowerCase().replace(/\.$/, "");
	const domainSuffix = `.${domain.toLowerCase()}`;
	if (!normalized.endsWith(domainSuffix)) return { kind: "unknown" };

	for (const entry of entries) {
		for (const preview of entry.publishedPreviews ?? []) {
			const expected = previewHostname(entry, preview, domain);
			if (normalized === expected) {
				return {
					kind: "target",
					entry,
					preview,
					hostname: expected,
					dormant: entry.containerPort === undefined,
				};
			}
		}
	}

	const label = normalized.slice(0, -domainSuffix.length);
	const staleEntry = entries.find(
		(entry) =>
			entry.previewSuffix &&
			label.endsWith(`-${sanitizeLabelPart(entry.previewSuffix)}`),
	);
	return staleEntry ? { kind: "stale", entry: staleEntry } : { kind: "unknown" };
}
