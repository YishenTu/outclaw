/**
 * Parse coverage output from stdin and verify the average function
 * coverage meets the minimum threshold. Pipe bun test --coverage into this.
 *
 * Usage: bun test --coverage 2>&1 | bun run scripts/check-coverage.ts
 */

const THRESHOLD = 85;

const COVERAGE_RE = /^\s+\S.*\|/;

const input = await Bun.stdin.text();

const coverages: number[] = [];
for (const line of input.split("\n")) {
	if (!COVERAGE_RE.test(line)) continue;
	const cols = line.split("|");
	const fnCov = cols[1]?.trim();
	if (fnCov) {
		const val = Number.parseFloat(fnCov);
		if (!Number.isNaN(val)) coverages.push(val);
	}
}

if (coverages.length === 0) {
	console.error("Could not parse coverage output");
	process.exit(1);
}

const avg = coverages.reduce((a, b) => a + b, 0) / coverages.length;

console.log(`Function coverage: ${avg.toFixed(1)}% (threshold: ${THRESHOLD}%)`);

if (avg < THRESHOLD) {
	console.error(`Coverage ${avg.toFixed(1)}% is below ${THRESHOLD}% threshold`);
	process.exit(1);
}
