import { readdir, readFile, stat } from "node:fs/promises";
import { join as joinPath, relative as relativePath } from "node:path";
import { join as posixPathJoin } from "node:path/posix";
import { it, type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import pretty from "pretty";
import { run } from "../../dist/index.mjs";

const testDataRootPath = posixPathJoin(import.meta.dirname, "test-cases");
const testOutputRootPath = posixPathJoin(
    import.meta.dirname,
    "..",
    "out",
    "test",
);

for (const item of await readdir(testDataRootPath, {
    withFileTypes: true,
    recursive: false,
})) {
    if (!item.isDirectory()) {
        continue;
    }

    const inputPath = joinPath(
        item.parentPath,
        item.name,
        "input",
        "index.html",
    );

    const expectedPath = joinPath(
        item.parentPath,
        item.name,
        "expected",
        "index.html",
    );

    const errorPath = joinPath(
        item.parentPath,
        item.name,
        "expected",
        "error.json",
    );

    const outputPath = joinPath(
        testOutputRootPath,
        relativePath(testDataRootPath, inputPath),
    );

    let hasError: boolean;
    try {
        const errorStats = await stat(errorPath);
        hasError = errorStats.isFile();
    } catch (error) {
        if (isNodeError(error)) {
            switch (error.code) {
                case "ENOENT": {
                    hasError = false;
                    break;
                }
                default:
                    throw error;
            }
        } else {
            throw error;
        }
    }

    it(item.name, async (test: TestContext) => {
        const args = [
            "--from",
            testDataRootPath,
            "--to",
            testOutputRootPath,
            inputPath,
        ];

        if (hasError) {
            const error = JSON.parse(
                await readFile(errorPath, { encoding: "utf-8" }),
            );

            if (
                typeof error === "object" &&
                error !== null &&
                Array.isArray(error.message)
            ) {
                error.message = error.message.join("\n");
            }

            await test.assert.rejects(() => run(args), error);
        } else {
            await run(args);
            test.assert.deepStrictEqual(
                normalizeHTML(
                    await readFile(outputPath, { encoding: "utf-8" }),
                ),
                normalizeHTML(
                    await readFile(expectedPath, { encoding: "utf-8" }),
                ),
            );
        }
    });
}

function normalizeHTML(value: string): string {
    const dom = new JSDOM(value, { includeNodeLocations: true });
    return pretty(dom.serialize().replaceAll("\r", ""), { ocd: true });
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
