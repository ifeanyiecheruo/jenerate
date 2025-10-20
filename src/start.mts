#!/usr/bin/env node

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
        runner.events.on("error", onError);

        if (runner.options.watch) {
            console.log(`Watching... press Esc to exit.`);
        }

        await runner.run(canceller.signal);
    } finally {
        runner.events.off("error", onError);
    }
} catch (error) {
    process.exitCode = 1;

    console.error(Error.isError(error) ? error.message : error);
} finally {
    process.stdin.off("keypress", onKeyPress);

    process.exit();
}

function onKeyPress(_str: string, { name }: { name: string }): void {
    if (name === "escape") {
        canceller.abort();
    }
}

function onError(error: unknown): void {
    console.error(Error.isError(error) ? error.message : error);
}
