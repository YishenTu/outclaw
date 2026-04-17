import { describe, expect, test } from "bun:test";
import { detectFileLanguage } from "../../../src/runtime/browser/detect-file-language.ts";

describe("detectFileLanguage", () => {
	test("detects common source and config file languages", () => {
		expect(detectFileLanguage("main.py")).toBe("python");
		expect(detectFileLanguage("lib.rs")).toBe("rust");
		expect(detectFileLanguage("server.go")).toBe("go");
		expect(detectFileLanguage("config.toml")).toBe("toml");
		expect(detectFileLanguage("layout.xml")).toBe("xml");
		expect(detectFileLanguage("settings.ini")).toBe("ini");
		expect(detectFileLanguage("Main.java")).toBe("java");
		expect(detectFileLanguage("main.c")).toBe("c");
		expect(detectFileLanguage("main.cpp")).toBe("cpp");
		expect(detectFileLanguage("script.ps1")).toBe("powershell");
	});

	test("detects basename-based languages", () => {
		expect(detectFileLanguage("Dockerfile")).toBe("dockerfile");
		expect(detectFileLanguage("Makefile")).toBe("makefile");
	});

	test("returns undefined for unsupported extensions", () => {
		expect(detectFileLanguage("archive.foo")).toBeUndefined();
	});
});
