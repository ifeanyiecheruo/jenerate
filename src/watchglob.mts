import type { GlobOptionsWithoutFileTypes, Stats } from "node:fs";
import { matchesGlob } from "node:path";
import type { EventEmitter } from "node:stream";
import type { FSWatcher, FSWatcherEventMap } from "chokidar";
import { watch } from "chokidar";

export type GlobWatcherOptions = GlobOptionsWithoutFileTypes;

export class GlobWatcher {
    private readonly _watcher: FSWatcher;

    public constructor(rootPath: string, pattern: string | string[]) {
        const patterns = Array.isArray(pattern) ? pattern : [pattern];
        this._watcher = watch([], {
            cwd: rootPath,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: true,
            ignored: (path: string, stats?: Stats): boolean => {
                if (stats && !stats.isFile()) {
                    return true;
                }

                return patterns.every((pattern) => !matchesGlob(path, pattern));
            },
        });
    }

    public get events(): EventEmitter<FSWatcherEventMap> {
        return this._watcher;
    }

    public start(): void {
        this._watcher.add(".");
    }

    public async close(): Promise<void> {
        this._watcher.unwatch(".");

        if (!this._watcher.closed) {
            await this._watcher.close();
        }
    }

    [Symbol.asyncDispose](): Promise<void> {
        return this.close();
    }
}
