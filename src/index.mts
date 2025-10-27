import EventEmitter from "node:events";
import { glob } from "node:fs/promises";
import {
    extname,
    join as joinPath,
    relative as relativePath,
    resolve as resolvePath,
} from "node:path";
import { parseCommandLine } from "./cli.mjs";
import { debounceAsync } from "./debounce.mjs";
import { createJenerateTask } from "./jenerate/jenerateTask.mjs";
import { createTaskRunner, type ITaskRunner } from "./task.mjs";
import { GlobWatcher } from "./watchglob.mjs";

const MAX_UPDATE_DELAY_SEC = 5;
const DEFAULT_UPDATE_DELAY_SEC = 0.5;

/* node:coverage disable */
export interface RunnerEventMap {
    start: [];
    prebuild: [];
    postbuild: [];
    end: [];
    error: [error: unknown];
}

export interface IRunner {
    readonly options: Readonly<IRunnerOptions>;
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
/* node:coverage enable */

export function createRunner(argv: string[]): IRunner {
    const cli = parseCommandLine(argv, {
        updateDelayMs: DEFAULT_UPDATE_DELAY_SEC,
    });

    const options: IRunnerOptions = cli;

    return new Runner(options);
}

class Runner implements IRunner {
    readonly events: EventEmitter<RunnerEventMap> = new RunnerEventEmitter();
    readonly options: Readonly<IRunnerOptions>;
    private _running = false;

    constructor(options: IRunnerOptions) {
        this.options = options;
    }

    async run(signal?: AbortSignal | undefined): Promise<void> {
        if (!this.options.watch) {
            signal = undefined;
        }

        try {
            if (signal) {
                await this._run(signal);
            } else {
                const controller = new AbortController();

                await new Promise((resolve, reject) => {
                    this.events.once("postbuild", exit).once("error", exit);

                    this._run(controller.signal)
                        .then(resolve)
                        .catch(reject)
                        .finally(() => {
                            this.events
                                .off("postbuild", exit)
                                .off("error", exit);
                        });
                });

                function exit(reason?: unknown) {
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

        const verbose = !!this.options.verbose;

        this._running = true;

        this._emitEvent(signal, "start");

        try {
            const srcRoot = resolvePath(this.options.from);
            const dstRoot = resolvePath(this.options.to);
            const runner = createTaskRunner();
            const taskId = runner.add(createJenerateTask(srcRoot, dstRoot), []);
            let updatePromise = Promise.resolve();

            try {
                for await (const item of glob(this.options.inputs, {
                    withFileTypes: true,
                    cwd: this.options.from,
                })) {
                    if (isSignalCanceled(signal)) {
                        return;
                    }

                    if (item.isFile()) {
                        add(joinPath(item.parentPath, item.name));
                    }
                }

                if (!this.options.watch) {
                    updatePromise = this._updateAndNotify(
                        runner,
                        signal,
                        verbose,
                    );
                    if (isSignalCanceled(signal)) {
                        return;
                    }
                } else {
                    const scheduleUpdate = this._createUpdateScheduler(
                        runner,
                        signal,
                        verbose,
                    );

                    updatePromise = then(updatePromise, scheduleUpdate());

                    const watcher = new GlobWatcher(
                        this.options.from,
                        this.options.inputs,
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
                    } else {
                        runner.setInputs(taskId, [path]);
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
        verbose: boolean,
    ): () => Promise<void> {
        const updateDelayMs = Math.max(
            1,
            Math.min(
                this.options.updateDelayMs ?? DEFAULT_UPDATE_DELAY_SEC * 1000,
                MAX_UPDATE_DELAY_SEC * 1000,
            ),
        );

        return debounceAsync(
            (signal) => this._updateAndNotify(runner, signal, verbose),
            updateDelayMs,
            MAX_UPDATE_DELAY_SEC * 1000,
            signal,
        );
    }

    private async _updateAndNotify(
        runner: ITaskRunner,
        signal: AbortSignal,
        _verbose: boolean,
    ): Promise<void> {
        if (runner.needsUpdate) {
            this._emitEvent(signal, "prebuild");
            try {
                await runner.update(signal);
            } catch (error) {
                this._emitEvent(signal, "error", error);
            } finally {
                this._emitEvent(signal, "postbuild");
            }
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

function isSignalCanceled(signal: AbortSignal): boolean {
    if (signal.aborted) {
        const { reason } = signal;

        if (typeof reason !== "undefined") {
            if (!Error.isError(reason) || reason.name !== "AbortError") {
                throw signal.reason;
            }
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
                const { reason } = signal;

                if (!Error.isError(reason) || reason.name !== "AbortError") {
                    reject(signal.reason);

                    return;
                }
            }

            resolve();
        }
    });
}

function then<T>(a: Promise<unknown>, b: Promise<T>): Promise<T> {
    return a.then(() => b);
}
