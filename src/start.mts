#!/usr/bin/env node

import { emitKeypressEvents } from "node:readline";
import { createRunner, parseCommandLine } from "./index.mjs";

try {
    const canceller = new AbortController();

    onceEscapeKeyPressed(() => {
        canceller.abort();
    });

    const runnerOptions = parseCommandLine(process.argv.slice(2));
    const runner = createRunner(runnerOptions);

    runner.events.on("error", (error) =>
        console.error(Error.isError(error) ? error.message : error),
    );

    await runner.run(canceller.signal);
} catch (error) {
    console.error(Error.isError(error) ? error.message : error);
}

function onceEscapeKeyPressed(callback: () => void): void {
    if (!process.stdin.isTTY) {
        return;
    }

    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.once("keypress", (_str: string, { name }) => {
        if (name === "escape") {
            callback();
        }
    });
}
