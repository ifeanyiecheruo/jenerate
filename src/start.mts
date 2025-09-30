#!/usr/bin/env node

import { emitKeypressEvents } from "node:readline";
import { run } from "./index.mjs";

try {
    const canceller = new AbortController();

    onceEscapeKeyPressed(() => {
        canceller?.abort();
    });

    await run(process.argv.slice(2), canceller);
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
