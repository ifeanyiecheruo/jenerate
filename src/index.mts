import { glob } from "node:fs/promises";
import {
    extname,
    join as joinPath,
    relative as relativePath,
    resolve as resolvePath,
} from "node:path";
import { parseArgs } from "node:util";
import { debounce } from "./debounce.mjs";
import { createJenerateTask } from "./jenerate/jenerateTask.mjs";
import { createTaskRunner } from "./task.mjs";
import { GlobWatcher } from "./watchglob.mjs";

export async function run(
    argv: string[],
    canceller?: AbortController | undefined,
): Promise<void> {
    const { values, positionals } = parseArgs({
        args: argv,
        tokens: true,
        allowPositionals: true,
        allowNegative: true,
        options: {
            watch: {
                type: "boolean",
                short: "w",
            },
            verbose: {
                type: "boolean",
                short: "v",
            },
            from: {
                type: "string",
                short: "f",
            },
            to: {
                type: "string",
                short: "t",
            },
            "update-delay-ms": {
                type: "string",
                short: "d",
                default: "500",
            },
        },
    });

    const { watch, from, to, "update-delay-ms": updateDelayStr } = values;

    if (positionals.length < 1) {
        positionals.push("**/*.html");
    }

    if (typeof from !== "string") {
        help();
    }

    if (typeof to !== "string") {
        help();
    }

    const updateDelayMs = Number.parseInt(updateDelayStr, 10);
    if (!Number.isInteger(updateDelayMs) || updateDelayMs < 1) {
        help();
    }

    const srcRoot = resolvePath(from);
    const dstRoot = resolvePath(to);
    const runner = createTaskRunner();
    const taskId = runner.add(createJenerateTask(srcRoot, dstRoot), []);

    try {
        for await (const item of glob(positionals, { withFileTypes: true })) {
            if (watch && canceller?.signal.aborted) {
                break;
            }
            if (item.isFile()) {
                add(joinPath(item.parentPath, item.name));
            }
        }

        if (!watch) {
            await runner.update();
            return;
        }

        const updateRunner = debounce(
            function updateRunner() {
                runner.update().catch((error) => {
                    console.error(error);
                });
            },
            updateDelayMs,
            canceller?.signal,
        );

        updateRunner();

        await using watcher = new GlobWatcher(positionals);

        await new Promise((resolve, reject) => {
            canceller?.signal.addEventListener("abort", resolve, {
                once: true,
            });

            watcher.events
                .on("add", (path) => {
                    add(path);
                    updateRunner();
                })
                .on("change", (path) => {
                    runner.invalidatePath(path, "change");
                    updateRunner();
                })
                .on("unlink", (path) => {
                    runner.invalidatePath(path, "delete");
                    updateRunner();
                })
                .on("error", reject);

            watcher.start().catch(reject);
        });
    } finally {
        runner.remove(taskId);
    }

    function add(path: string): void {
        if (
            !relativePath(srcRoot, path).startsWith("..") &&
            extname(path) === ".html"
        ) {
            const inputs = runner.getInputs(taskId);
            if (inputs) {
                inputs.push(path);
                runner.setInputs(taskId, inputs);
            }
        }

        runner.invalidatePath(path, "add");
    }
}

function help(): never {
    throw new Error(
        `jenerate [--verbose] [--watch] [--from <src-path>] [--to <destination-path>] [--update-delay-ms <positive-integer>]<source-glob>+`,
    );
}
