import { describe, expect, test } from "bun:test";
import { createNativeFolderPicker } from "../../../../src/runtime/browser/coding/folder-picker.ts";

describe("createNativeFolderPicker", () => {
	test("returns selected path on success", async () => {
		const picker = createNativeFolderPicker({
			platform: "darwin",
			spawn: async (command) => {
				expect(command[0]).toBe("osascript");
				return { exitCode: 0, stdout: "/Users/dev/projects/foo\n", stderr: "" };
			},
		});
		await expect(picker()).resolves.toEqual({
			status: "selected",
			path: "/Users/dev/projects/foo",
		});
	});

	test("returns canceled when the dialog reports the user-cancel exit code", async () => {
		const picker = createNativeFolderPicker({
			platform: "darwin",
			spawn: async () => ({
				exitCode: 1,
				stdout: "",
				stderr: "User canceled.\n",
			}),
		});
		await expect(picker()).resolves.toEqual({ status: "canceled" });
	});

	test("returns canceled when stdout is empty after a successful exit", async () => {
		const picker = createNativeFolderPicker({
			platform: "linux",
			spawn: async (command) => {
				expect(command[0]).toBe("zenity");
				return { exitCode: 0, stdout: "\n", stderr: "" };
			},
		});
		await expect(picker()).resolves.toEqual({ status: "canceled" });
	});

	test("reports unavailable when the dialog binary cannot be spawned", async () => {
		const picker = createNativeFolderPicker({
			platform: "linux",
			spawn: async () => {
				throw new Error("zenity: command not found");
			},
		});
		await expect(picker()).resolves.toEqual({
			status: "unavailable",
			message: "zenity: command not found",
		});
	});

	test("reports unavailable on unknown platforms", async () => {
		const picker = createNativeFolderPicker({
			platform: "freebsd" as NodeJS.Platform,
			spawn: async () => {
				throw new Error("should not be called");
			},
		});
		await expect(picker()).resolves.toMatchObject({
			status: "unavailable",
		});
	});
});
