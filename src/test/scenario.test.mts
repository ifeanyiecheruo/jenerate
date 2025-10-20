import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath, relative as relativePath } from "node:path";
import { after, describe, it, type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import pretty from "pretty";
import { createRunner } from "../../dist/index.mjs";

interface PassTestInfo {
    type: "pass";
    name: string;
    testDataRootPath: string;
    testOutputRootPath: string;
    inputPath: string;
    expectedPath: string;
}

interface ErrorTestInfo {
    type: "error";
    name: string;
    testDataRootPath: string;
    testOutputRootPath: string;
    inputPath: string;
    errorPath: string;
}

type TestInfo = PassTestInfo | ErrorTestInfo;

describe("suite", async () => {
    const runId = randomUUID();
    const testDataRootPath = joinPath(import.meta.dirname, "test-cases");
    const testOutputRootPath = joinPath(tmpdir(), "jenerate", "tests");

    await createBatchTestSuite(runId, testDataRootPath, testOutputRootPath);
    await createWatchTestSuite(runId, testDataRootPath, testOutputRootPath);
    await createRunnerTestSuite();

    after(async () => {
        await rm(joinPath(testOutputRootPath, runId), { recursive: true });
    });
});

async function createBatchTestSuite(
    runId: string,
    testDataRootPath: string,
    testOutputRootPath: string,
): Promise<void> {
    await describe("batch tests", async () => {
        for await (const item of await discoverTests(
            testDataRootPath,
            joinPath(testOutputRootPath, runId, "out", "batch"),
        )) {
            switch (item.type) {
                case "pass": {
                    await it(item.name, async (test: TestContext) => {
                        await doPassTest(test, item);
                    });
                    break;
                }
                case "error": {
                    await it(item.name, async (test: TestContext) => {
                        await doErrorTest(test, item);
                    });
                    break;
                }

                default: {
                    assert.fail();
                }
            }
        }
    });
}

async function createWatchTestSuite(
    runId: string,
    testDataRootPath: string,
    testOutputRootPath: string,
): Promise<void> {
    const newTestDataRootPath = joinPath(
        testOutputRootPath,
        runId,
        "in",
        "watch",
    );
    await describe("watch tests", async () => {
        for await (const item of await discoverTests(
            testDataRootPath,
            joinPath(testOutputRootPath, runId, "out", "watch"),
        )) {
            switch (item.type) {
                case "pass": {
                    await it(`watch-${item.name}`, async (test: TestContext) => {
                        await doPassTest(
                            test,
                            item,
                            createTestSteps(item, newTestDataRootPath),
                        );
                    });
                    break;
                }
                case "error": {
                    await it(`watch-${item.name}`, async (test: TestContext) => {
                        await doErrorTest(
                            test,
                            item,
                            createTestSteps(item, newTestDataRootPath),
                        );
                    });
                    break;
                }

                default: {
                    assert.fail();
                }
            }
        }
    });
}

async function createRunnerTestSuite() {
    describe("cmdline", async () => {
        it("from required", async (test) => {
            test.assert.throws(
                () => createRunner(["--to", "./out"]),
                new Error(
                    `--from required.\njenerate [--verbose|-v] [--watch|-w] {--from|-f <src-path>} {--to|-t <destination-path>} [--update-delay|d <update-delay>] [<source-glob>+]`,
                ),
            );
        });

        it("to required", async (test) => {
            test.assert.throws(
                () => createRunner(["--from", "./dist"]),
                new Error(
                    `--to required.\njenerate [--verbose|-v] [--watch|-w] {--from|-f <src-path>} {--to|-t <destination-path>} [--update-delay|d <update-delay>] [<source-glob>+]`,
                ),
            );
        });

        it("update-delay must be number", async (test) => {
            test.assert.throws(
                () =>
                    createRunner([
                        "--from",
                        "./dist",
                        "--to",
                        "./out",
                        "--update-delay",
                        "bar",
                    ]),
                new Error(
                    `--update-delay must be a number.\njenerate [--verbose|-v] [--watch|-w] {--from|-f <src-path>} {--to|-t <destination-path>} [--update-delay|d <update-delay>] [<source-glob>+]`,
                ),
            );
        });
    });
}
async function doPassTest(
    test: TestContext,
    info: PassTestInfo,
    steps?: ITestSteps | undefined,
) {
    if (steps?.setupSteps) {
        await steps.setupSteps();
    }

    const { inputPath, expectedPath, testDataRootPath, testOutputRootPath } =
        info;

    const from = testDataRootPath;
    const to = testOutputRootPath;
    const watch = !!steps;
    const updateDelayMs = "0";

    const runner = createRunner([
        "--from",
        from,
        "--to",
        to,
        watch ? "--watch" : "--no-watch",
        "--update-delay",
        updateDelayMs,
        inputPath,
    ]);

    if (!steps) {
        await test.assert.doesNotReject(async () => await runner.run());
    } else {
        await test.assert.doesNotReject(async () => {
            const controller = new AbortController();

            runner.events
                .on("error", (error) => {
                    test.assert.ifError(error);
                    controller.abort(error);
                })
                .on("postbuild", () => {
                    if (!steps.postBuildSteps) {
                        controller.abort();
                    } else {
                        steps.postBuildSteps
                            .next()
                            .then((value) => {
                                if (value.done) {
                                    controller.abort();
                                }
                            })
                            .catch((error) => {
                                controller.abort(error);
                            });
                    }
                });

            await runner.run(controller.signal);
        });
    }

    await test.assert.deepStrictEqual(
        normalizeHTML(
            await readFile(joinPath(to, inputPath), {
                encoding: "utf-8",
            }),
        ),
        normalizeHTML(
            await readFile(joinPath(from, expectedPath), {
                encoding: "utf-8",
            }),
        ),
    );

    if (steps?.tearDownSteps) {
        await steps.tearDownSteps();
    }

    await rm(to, { recursive: true });
}

async function doErrorTest(
    test: TestContext,
    info: ErrorTestInfo,
    steps?: ITestSteps | undefined,
) {
    if (steps?.setupSteps) {
        await steps.setupSteps();
    }

    const { inputPath, errorPath, testDataRootPath, testOutputRootPath } = info;
    const expectedError = JSON.parse(
        await readFile(joinPath(testDataRootPath, errorPath), {
            encoding: "utf-8",
        }),
    );

    if (
        typeof expectedError === "object" &&
        expectedError !== null &&
        Array.isArray(expectedError.message)
    ) {
        expectedError.message = expectedError.message.join("\n");
    }

    const from = testDataRootPath;
    const to = testOutputRootPath;
    const watch = !!steps;
    const updateDelayMs = "0";

    const runner = createRunner([
        "--from",
        from,
        "--to",
        to,
        watch ? "--watch" : "--no-watch",
        "--update-delay",
        updateDelayMs,
        inputPath,
    ]);

    if (!steps) {
        await test.assert.rejects(
            async () => await runner.run(),
            expectedError,
        );
    } else {
        const asyncErrors: unknown[] = [];

        await test.assert.doesNotReject(async () => {
            const controller = new AbortController();

            runner.events
                .on("error", (error) => {
                    asyncErrors.push(error);
                })
                .on("postbuild", () => {
                    if (!steps.postBuildSteps) {
                        controller.abort();
                    } else {
                        steps.postBuildSteps
                            .next()
                            .then((value) => {
                                if (value.done) {
                                    controller.abort();
                                }
                            })
                            .catch((error) => {
                                controller.abort(error);
                            });
                    }
                });

            await runner.run(controller.signal);
        });

        test.assert.ok(asyncErrors.length > 0);

        await Promise.allSettled(
            asyncErrors.map((item) =>
                test.assert.rejects(() => Promise.reject(item), expectedError),
            ),
        );

        if (steps?.tearDownSteps) {
            await steps.tearDownSteps();
        }
    }

    await rm(to, { recursive: true });
}

async function* discoverTests(
    testDataRootPath: string,
    testOutputRootPath: string,
): AsyncIterable<TestInfo> {
    for (const item of await readdir(testDataRootPath, {
        withFileTypes: true,
        recursive: false,
    })) {
        if (!item.isDirectory()) {
            continue;
        }

        const testDataPath = joinPath(
            relativePath(testDataRootPath, item.parentPath),
            item.name,
        );
        const inputPath = joinPath(testDataPath, "input", "index.html");
        const expectedPath = joinPath(testDataPath, "expected", "index.html");
        const errorPath = joinPath(testDataPath, "expected", "error.json");
        const hasError = await fileExists(
            joinPath(testDataRootPath, errorPath),
        );

        if (hasError) {
            yield {
                type: "error",
                name: item.name,
                inputPath,
                errorPath,
                testDataRootPath,
                testOutputRootPath,
            };
        } else {
            yield {
                type: "pass",
                name: item.name,
                inputPath,
                expectedPath,
                testDataRootPath,
                testOutputRootPath,
            };
        }
    }
}

interface ITestSteps {
    setupSteps?: () => Promise<void>;
    postBuildSteps?: AsyncIterator<void>;
    tearDownSteps?: () => Promise<void>;
}

function createTestSteps(
    item: TestInfo,
    newTestDataRootPath: string,
): ITestSteps {
    const oldTestDataRootPath = item.testDataRootPath;

    return {
        setupSteps: async function setupSteps(): Promise<void> {
            await mkdir(newTestDataRootPath, { recursive: true });
            item.testDataRootPath = newTestDataRootPath;

            await cp(oldTestDataRootPath, newTestDataRootPath, {
                recursive: true,
            });
        },

        // postBuildSteps: (async function* postBuildSteps(): AsyncIterable<void> {
        // })()[Symbol.asyncIterator](),

        tearDownSteps: async function teardownSteps(): Promise<void> {
            await rm(newTestDataRootPath, { recursive: true });
        },
    };
}

function normalizeHTML(value: string): string {
    const dom = new JSDOM(value, { includeNodeLocations: true });

    return pretty(dom.serialize().replaceAll("\r", ""), { ocd: true });
}

async function fileExists(path: string): Promise<boolean> {
    try {
        const errorStats = await stat(path);

        return errorStats.isFile();
    } catch (error) {
        if (isNodeError(error)) {
            switch (error.code) {
                case "ENOENT": {
                    return false;
                }
                default: {
                    break;
                }
            }
        }

        throw error;
    }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return (
        error instanceof Error &&
        ("errno" in error ||
            "code" in error ||
            "path" in error ||
            "syscall" in error)
    );
}
