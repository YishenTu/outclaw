/**
 * Run tests with coverage and verify the average function coverage
 * meets the minimum threshold. Exits non-zero on failure.
 */

const THRESHOLD = 85;

const COVERAGE_RE = /^\s+\S.*\|/;

const proc = Bun.spawn(["bun", "test", "--coverage"], {
	stdout: "pipe",
	stderr: "pipe",
});

const [stdout, stderr] = await Promise.all([
	new Response(proc.stdout).text(),
	new Response(proc.stderr).text(),
]);
const exitCode = await proc.exited;

// Coverage table goes to stderr, test results to stdout
process.stdout.write(stdout);
process.stderr.write(stderr);

if (exitCode !== 0) {
	process.exit(exitCode);
}

// Parse function coverage (first numeric column) from each file row
const coverages: number[] = [];
for (const line of stderr.split("\n")) {
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

console.log(
	`\nFunction coverage: ${avg.toFixed(1)}% (threshold: ${THRESHOLD}%)`,
);

if (avg < THRESHOLD) {
	console.error(`Coverage ${avg.toFixed(1)}% is below ${THRESHOLD}% threshold`);
	process.exit(1);
}
