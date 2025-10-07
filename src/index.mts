import EventEmitter from "node:events";
import { glob } from "node:fs/promises";
import {
    extname,
    join as joinPath,
    relative as relativePath,
    resolve as resolvePath,
} from "node:path";
import { parseArgs } from "node:util";
import { debounceAsync } from "./debounce.mjs";
import { createJenerateTask } from "./jenerate/jenerateTask.mjs";
import { createTaskRunner, type ITaskRunner } from "./task.mjs";
import { GlobWatcher } from "./watchglob.mjs";

const MAX_UPDATE_DELAY_MS = 5_000;
const DEFAULT_UPDATE_DELAY_MS = 500;

export interface RunnerEventMap {
    start: [];
    prebuild: [];
    postbuild: [];
    end: [];
    error: [error: unknown];
}

export interface IRunner {
    readonly events: EventEmitter<RunnerEventMap>;

    run(signal?: AbortSignal | undefined): Promise<void>;
}

export interface IRunnerOptions {
    from: string;
    to: string;
    inputs: string[];
    verbose?: boolean | undefined;
    watch?: boolean | undefined;
    updateDelayMs?: number | undefined;
}

export function createRunner(options: IRunnerOptions): IRunner {
    return new Runner(options);
}

export function parseCommandLine(argv: string[]): IRunnerOptions {
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
                default: String(DEFAULT_UPDATE_DELAY_MS),
            },
        },
    });

    const {
        verbose,
        watch,
        from,
        to,
        "update-delay-ms": updateDelayStr,
    } = values;

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
    if (!Number.isInteger(updateDelayMs)) {
        help();
    }

    return {
        verbose: verbose,
        watch: watch,
        from: from,
        to: to,
        inputs: positionals,
        updateDelayMs: updateDelayMs,
    };
}

class Runner implements IRunner {
    readonly events: EventEmitter<RunnerEventMap> = new RunnerEventEmitter();
    private readonly _options: IRunnerOptions;
    private _running = false;

    constructor(options: IRunnerOptions) {
        this._options = options;
    }

    async run(signal?: AbortSignal | undefined): Promise<void> {
        try {
            if (signal) {
                await this._run(signal);
            } else {
                const controller = new AbortController();

                await new Promise((resolve, reject) => {
                    this.events
                        .once("postbuild", exit)
                        .once("error", exitWithError);

                    this._run(controller.signal)
                        .then(resolve)
                        .catch(reject)
                        .finally(() => {
                            this.events
                                .off("postbuild", exit)
                                .off("error", exitWithError);
                        });
                });

                function exit() {
                    controller.abort();
                }

                function exitWithError(reason: unknown) {
                    controller.abort(reason);
                }
            }
        } catch (error) {
            if (!Error.isError(error) || error.name !== "AbortError") {
                throw error;
            }
        }
    }

    private async _run(signal: AbortSignal): Promise<void> {
        if (this._running) {
            throw new Error("Already started");
        }

        this._running = true;
        this._emitEvent(signal, "start");

        try {
            const srcRoot = resolvePath(this._options.from);
            const dstRoot = resolvePath(this._options.to);
            const runner = createTaskRunner();
            const taskId = runner.add(createJenerateTask(srcRoot, dstRoot), []);
            let updatePromise = Promise.resolve();

            try {
                for await (const item of glob(this._options.inputs, {
                    withFileTypes: true,
                    cwd: this._options.from,
                })) {
                    if (isSignalCanceled(signal)) {
                        return;
                    }

                    if (item.isFile()) {
                        add(joinPath(item.parentPath, item.name));
                    }
                }

                if (!this._options.watch) {
                    updatePromise = this._updateAndNotify(runner, signal);
                    if (isSignalCanceled(signal)) {
                        return;
                    }
                } else {
                    const scheduleUpdate = this._createUpdateScheduler(
                        runner,
                        signal,
                    );

                    updatePromise = then(updatePromise, scheduleUpdate());

                    const watcher = new GlobWatcher(
                        this._options.from,
                        this._options.inputs,
                    );

                    try {
                        watcher.events
                            .on("add", handleAdd)
                            .on("change", handleChange)
                            .on("unlink", handleDelete)
                            .on("error", handleError);

                        watcher.start();

                        await waitForCancellation(signal);
                    } finally {
                        watcher.events
                            .off("add", handleAdd)
                            .off("change", handleChange)
                            .off("unlink", handleDelete)
                            .off("error", handleError);

                        await watcher.close();
                    }

                    function handleAdd(path: string): void {
                        add(path);
                        updatePromise = then(updatePromise, scheduleUpdate());
                    }

                    function handleChange(path: string): void {
                        runner.invalidatePath(path, "change");
                        updatePromise = then(updatePromise, scheduleUpdate());
                    }

                    function handleDelete(path: string): void {
                        runner.invalidatePath(path, "delete");
                        updatePromise = then(updatePromise, scheduleUpdate());
                    }

                    const that = this;
                    function handleError(error: unknown): void {
                        that._emitEvent(
                            signal,
                            "error",
                            new Error("Error watching file changes", {
                                cause: error,
                            }),
                        );
                    }
                }
            } finally {
                try {
                    await updatePromise;
                } finally {
                    runner.remove(taskId);
                }
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
        } finally {
            this._running = false;
            this._emitEvent(signal, "end");
        }
    }

    private _createUpdateScheduler(
        runner: ITaskRunner,
        signal: AbortSignal,
    ): () => Promise<void> {
        const updateDelayMs = Math.max(
            1,
            Math.min(
                this._options.updateDelayMs ?? DEFAULT_UPDATE_DELAY_MS,
                MAX_UPDATE_DELAY_MS,
            ),
        );

        return debounceAsync(
            (signal) => this._updateAndNotify(runner, signal),
            updateDelayMs,
            MAX_UPDATE_DELAY_MS,
            signal,
        );
    }

    private async _updateAndNotify(
        runner: ITaskRunner,
        signal: AbortSignal,
    ): Promise<void> {
        this._emitEvent(signal, "prebuild");

        try {
            await runner.update(signal);
        } catch (error) {
            this._emitEvent(signal, "error", error);
        } finally {
            this._emitEvent(signal, "postbuild");
        }
    }

    private _emitEvent<
        K extends keyof RunnerEventMap,
        V extends K extends keyof RunnerEventMap ? RunnerEventMap[K] : never,
    >(signal: AbortSignal, name: K, ...args: V): void {
        this.events.emit(name, ...args);

        if (isSignalCanceled(signal)) {
            return;
        }
    }
}

class RunnerEventEmitter extends EventEmitter<RunnerEventMap> {}

function help(): never {
    throw new Error(
        `jenerate [--verbose] [--watch] [--from <src-path>] [--to <destination-path>] [--update-delay-ms <positive-integer>]<source-glob>+`,
    );
}

function isSignalCanceled(signal: AbortSignal): boolean {
    if (signal.aborted) {
        if (typeof signal.reason !== "undefined") {
            throw signal.reason;
        }

        return true;
    }

    return false;
}

async function waitForCancellation(signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        handleCanceled();

        signal.addEventListener("abort", handleCanceled, {
            once: true,
        });

        function handleCanceled(): void {
            if (signal.aborted) {
                if (typeof signal.reason !== "undefined") {
                    reject(signal.reason);
                } else {
                    resolve();
                }
            }
        }
    });
}

function then<T>(a: Promise<unknown>, b: Promise<T>): Promise<T> {
    return a.then(() => b);
}
