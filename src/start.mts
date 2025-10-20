#!/usr/bin/env node

import { emitKeypressEvents } from "node:readline";
import { createRunner } from "./index.mjs";

process.exitCode = 0;

try {
    const canceller = new AbortController();
    onceEscapeKeyPressed(() => canceller.abort());

    const runner = createRunner(process.argv.slice(2));

    runner.events.on("error", (error) => {
        console.error(Error.isError(error) ? error.message : error);
    });

    if (runner.options.watch) {
        console.log(`Watching... press Esc to exit.`);
    }

    await runner.run(canceller.signal);
} catch (error) {
    process.exitCode = 1;

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
