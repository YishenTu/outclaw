import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { useState } from "react";
import { TextArea } from "../../../../src/frontend/tui/composer/text-area.tsx";

function createOutputStream() {
	const stream = new PassThrough() as PassThrough &
		NodeJS.WriteStream & {
			columns: number;
			isTTY: boolean;
			rows: number;
		};
	stream.columns = 80;
	stream.isTTY = false;
	stream.rows = 24;
	return stream;
}

async function flushUpdates() {
	for (let index = 0; index < 5; index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

describe("TextArea", () => {
	test("preserves fast typing when consecutive batches arrive before rerender", async () => {
		const stdout = createOutputStream();
		const stderr = createOutputStream();
		const stdin = new PassThrough() as PassThrough &
			NodeJS.ReadStream & {
				isTTY: boolean;
			};
		stdin.isTTY = false;
		const submissions: string[] = [];

		function Harness() {
			const [value, setValue] = useState("");
			return (
				<TextArea
					value={value}
					onChange={setValue}
					onSubmit={(nextValue) => {
						submissions.push(nextValue);
					}}
					rows={1}
					maxRows={1}
				/>
			);
		}

		const app = render(<Harness />, {
			exitOnCtrlC: false,
			patchConsole: false,
			stderr,
			stdin,
			stdout,
		});

		try {
			await flushUpdates();
			stdin.write("f");
			await new Promise<void>((resolve) => setImmediate(resolve));
			stdin.write("e");
			await flushUpdates();
			stdin.write("\r");
			await flushUpdates();

			expect(submissions).toEqual(["fe"]);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});
});
