import { copyFile, mkdir, stat } from "node:fs/promises";
import {
    dirname,
    join as joinPath,
    relative as relativePath,
    resolve as resolvePath,
} from "node:path";
import { fileURLToPath } from "node:url";
import type { ITaskContext, Task } from "../task.mjs";
import { jenerateHTML } from "./jenerateHTML.mjs";

export function createJenerateTask(srcRoot: string, dstRoot: string): Task {
    // It's important that absSrcRoot and absDstRoot end with / so they are treated as folders and not as files
    const absSrcRoot = `${resolvePath(srcRoot)}/`;
    const absDstRoot = `${resolvePath(dstRoot)}/`;

    return async function jenerate(
        ctx: ITaskContext,
        inputs: string[],
    ): Promise<void> {
        for (const input of inputs) {
            if (ctx.signal?.aborted) {
                break;
            }

            const absInput = resolvePath(input);
            const { dependencies, assets } = await jenerateHTML({
                inputFilePath: absInput,
                outputFilePath: joinPath(
                    absDstRoot,
                    relativePath(absSrcRoot, absInput),
                ),
                inputRootPath: absSrcRoot,
                signal: ctx.signal,
            });

            for (const item of dependencies) {
                if (item.ref.protocol === "file:") {
                    const path = fileURLToPath(item.ref);
                    ctx.dependOn(path);
                }
            }

            const existingPaths: string[] = [];

            for (const item of assets) {
                if (item.ref.protocol === "file:") {
                    const path = fileURLToPath(item.ref);
                    if (await exists(path)) {
                        existingPaths.push(path);
                    }
                }
            }

            await ctx.do(copyAsset, existingPaths);
        }
    };

    async function copyAsset(
        _ctx: ITaskContext,
        inputs: string[],
    ): Promise<void> {
        for (const input of inputs) {
            const output = joinPath(
                absDstRoot,
                relativePath(absSrcRoot, input),
            );

            await mkdir(dirname(output), { recursive: true });
            await copyFile(input, output);
        }
    }
}

async function exists(path: string): Promise<boolean> {
    try {
        const stats = await stat(path);

        return stats.isFile();
    } catch (error) {
        if (
            isNodeError(error) &&
            (error.code === "ENOENT" || error.code === "EPERM")
        ) {
            return false;
        }

        throw error;
    }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return (
        Error.isError(error) &&
        ("errno" in error ||
            "code" in error ||
            "path" in error ||
            "syscall" in error)
    );
}
