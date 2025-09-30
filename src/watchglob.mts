import type { GlobOptionsWithoutFileTypes } from "node:fs";
import { glob } from "node:fs/promises";
import { join as joinPath } from "node:path";
import type { EventEmitter } from "node:stream";
import type { FSWatcher, FSWatcherEventMap } from "chokidar";
import { watch } from "chokidar";

export type GlobWatcherOptions = GlobOptionsWithoutFileTypes;

export class GlobWatcher {
    private readonly _pattern: string | string[];
    private readonly _options: GlobWatcherOptions | undefined;
    private readonly _watcher: FSWatcher;
    private _running: boolean = false;

    public constructor(
        pattern: string | string[],
        options?: GlobWatcherOptions,
    ) {
        this._pattern = pattern;
        this._options = options;
        this._watcher = watch([], { awaitWriteFinish: true });
    }

    public get events(): EventEmitter<FSWatcherEventMap> {
        return this._watcher;
    }

    public async start(): Promise<void> {
        if (this._running) {
            return;
        }

        const files = glob(
            this._pattern,
            this._options ?? { withFileTypes: false },
        );

        this._watcher.add(await Array.fromAsync(files));

        this._running = true;
    }

    public async stop(): Promise<void> {
        for (const [dir, filenames] of Object.entries(
            this._watcher.getWatched(),
        )) {
            for (const filename of filenames) {
                this._watcher.unwatch(joinPath(dir, filename));
            }
        }

        this._running = false;
    }

    public async close(): Promise<void> {
        await this.stop();

        if (!this._watcher.closed) {
            await this._watcher.close();
        }
    }

    [Symbol.asyncDispose](): Promise<void> {
        return this.close();
    }
}
