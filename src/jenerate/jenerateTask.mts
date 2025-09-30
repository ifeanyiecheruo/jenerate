import { copyFile, mkdir } from "node:fs/promises";
import {
    dirname,
    join as joinPath,
    relative as relativePath,
    resolve as resolvePath,
} from "node:path";
import { fileURLToPath } from "node:url";
import type { ITaskContext, Task } from "../task.mjs";
import { jenerateHTML } from "./jenerate.mjs";

export function createJenerateTask(srcRoot: string, dstRoot: string): Task {
    const _srcRoot = resolvePath(srcRoot);
    const _dstRoot = resolvePath(dstRoot);

    return async function jenerate(
        ctx: ITaskContext,
        inputs: string[],
    ): Promise<void> {
        for (const input of inputs) {
            const dstPath = joinPath(_dstRoot, relativePath(_srcRoot, input));

            await mkdir(dirname(dstPath), { recursive: true });

            const { dependencies, assets } = await jenerateHTML({
                from: input,
                to: dstPath,
                base: _srcRoot,
            });

            for (const item of dependencies) {
                if (item.protocol === "file:") {
                    ctx.dependOn(fileURLToPath(item));
                }
            }

            const fileAssets = [...assets]
                .filter((item) => item.protocol === "file:")
                .map((item) => fileURLToPath(item));

            ctx.do(copyAsset, fileAssets);
        }
    };

    async function copyAsset(
        _ctx: ITaskContext,
        inputs: string[],
    ): Promise<void> {
        for (const input of inputs) {
            const dstPath = joinPath(_dstRoot, relativePath(_srcRoot, input));

            await mkdir(dirname(dstPath), { recursive: true });
            await copyFile(input, dstPath);
        }
    }
}
