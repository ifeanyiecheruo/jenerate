#!/usr/bin/env node

import { relative } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { createRunner } from "./index.mjs";

process.exitCode = 0;

const canceller = new AbortController();

try {
    if (process.stdin.isTTY) {
        emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        process.stdin.once("keypress", onKeyPress);
    }

    const runner = createRunner(process.argv.slice(2));

    try {
        if (runner.options.watch) {
            runner.events
                .on("prebuild", onPrebuild)
                .on("postbuild", onPostbuild)
                .on("error", onError);

            console.log(
                `Watching ${relative(
                    process.cwd(),
                    runner.options.from,
                )} press Esc to exit.`,
            );
        }

        await runner.run(canceller.signal);
    } finally {
        runner.events
            .off("error", onError)
            .off("postbuild", onPostbuild)
            .off("prebuild", onPrebuild);
    }
} catch (error) {
    process.exitCode = 1;

    onError(error);
} finally {
    process.stdin.off("keypress", onKeyPress);

    process.exit();
}

function onKeyPress(_str: string, { name }: { name: string }): void {
    if (name === "escape") {
        canceller.abort();
    }
}

function onPrebuild(): void {
    console.log("Building...");
}

function onPostbuild(): void {
    console.log("Built.");
}

function onError(error: unknown): void {
    console.error(Error.isError(error) ? error.message : error);
}
