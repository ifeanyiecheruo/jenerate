import { describe, it, type TestContext } from "node:test";
import { parseCommandLine } from "../dist/cli.mjs";

function secondsToMilliSeconds(value: number): number {
    return value * 1000;
}

describe("parseCommandLine", async () => {
    it("parses argv", async (test: TestContext) => {
        const actual = parseCommandLine(
            [
                "--verbose",
                "--watch",
                "--from",
                "./dist",
                "--to",
                "./out",
                "--update-delay",
                "10",
                "./client-a/src/**/*.html",
                "./client-b/src/**/*.html",
            ],
            { updateDelayMs: 0 },
        );

        test.assert.deepStrictEqual(actual, {
            verbose: true,
            watch: true,
            from: "./dist",
            to: "./out",
            updateDelayMs: secondsToMilliSeconds(10),
            inputs: ["./client-a/src/**/*.html", "./client-b/src/**/*.html"],
        });
    });

    it("negates booleans", async (test: TestContext) => {
        const actual = parseCommandLine(
            [
                "--no-verbose",
                "--no-watch",
                "--from",
                "./dist",
                "--to",
                "./out",
                "--update-delay",
                "10",
                "./client-a/src/**/*.html",
                "./client-b/src/**/*.html",
            ],
            { updateDelayMs: 0 },
        );

        test.assert.deepStrictEqual(actual, {
            verbose: false,
            watch: false,
            from: "./dist",
            to: "./out",
            updateDelayMs: secondsToMilliSeconds(10),
            inputs: ["./client-a/src/**/*.html", "./client-b/src/**/*.html"],
        });
    });

    it("provides defaults", async (test: TestContext) => {
        const actual = parseCommandLine(["--from", "./dist", "--to", "./out"], {
            updateDelayMs: 999,
        });

        test.assert.deepStrictEqual(actual, {
            verbose: undefined,
            watch: undefined,
            from: "./dist",
            to: "./out",
            updateDelayMs: 999,
            inputs: ["**/*.html"],
        });
    });

    it("--from is required", async (test: TestContext) => {
        test.assert.throws(
            () => parseCommandLine(["--to", "./out"], { updateDelayMs: 0 }),
            new Error(
                `--from required.\njenerate [--verbose|-v] [--watch|-w] {--from|-f <src-path>} {--to|-t <destination-path>} [--update-delay|d <update-delay>] [<source-glob>+]`,
            ),
        );
    });

    it("--to is required", async (test: TestContext) => {
        test.assert.throws(
            () => parseCommandLine(["--from", "./out"], { updateDelayMs: 0 }),
            new Error(
                `--to required.\njenerate [--verbose|-v] [--watch|-w] {--from|-f <src-path>} {--to|-t <destination-path>} [--update-delay|d <update-delay>] [<source-glob>+]`,
            ),
        );
    });

    it("--update-delay must be number", async (test: TestContext) => {
        test.assert.throws(
            () =>
                parseCommandLine(
                    [
                        "--from",
                        "./dist",
                        "--to",
                        "./out",
                        "--update-delay",
                        "bar",
                    ],
                    { updateDelayMs: 0 },
                ),
            new Error(
                `--update-delay must be a number.\njenerate [--verbose|-v] [--watch|-w] {--from|-f <src-path>} {--to|-t <destination-path>} [--update-delay|d <update-delay>] [<source-glob>+]`,
            ),
        );
    });
});
