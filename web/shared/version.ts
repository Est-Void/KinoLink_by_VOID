// KinoLink v2 shared version: single source of truth for the branch.
// The userscript sends it as ?v=, the player compares against it.
// Branch rule: versions here are always x.y.z-dev (see contract.md).
// Keep in sync with appVersion in server/main.go (checked in CI).

export const VERSION = '2.0.3-dev';

interface Parsed {
	numbers: number[];
	prerelease: string;
}

function parse(version: string): Parsed | null {
	const match = /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.\-]+))?$/.exec(version.trim());
	if (!match) return null;
	return {
		numbers: match[1].split('.').map(Number),
		prerelease: match[2] ?? '',
	};
}

/**
 * Compare two versions: -1 if a < b, 0 if equal, 1 if a > b.
 * Numeric parts compared per component; a prerelease (e.g. -dev)
 * is older than the same numbers without one. Garbage never throws:
 * unparsable input counts as older than any valid version.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
	const pa = parse(a);
	const pb = parse(b);
	if (!pa && !pb) return 0;
	if (!pa) return -1;
	if (!pb) return 1;

	const len = Math.max(pa.numbers.length, pb.numbers.length);
	for (let i = 0; i < len; i++) {
		const x = pa.numbers[i] ?? 0;
		const y = pb.numbers[i] ?? 0;
		if (x < y) return -1;
		if (x > y) return 1;
	}
	if (pa.prerelease === pb.prerelease) return 0;
	if (pa.prerelease === '') return 1;
	if (pb.prerelease === '') return -1;
	return pa.prerelease < pb.prerelease ? -1 : 1;
}

/** True when the installed script is older than required (or missing/garbage). */
export function isOutdated(installed: string, required: string): boolean {
	if (!installed) return true;
	return compareVersions(installed, required) < 0;
}
