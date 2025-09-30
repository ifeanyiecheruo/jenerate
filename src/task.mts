import assert from "node:assert";
import { randomUUID } from "node:crypto";

export type TaskId = string;
export type Task = (context: ITaskContext, inputs: string[]) => Promise<void>;

export interface ITaskContext {
    dependOn(path: string): void;
    do(task: Task, inputs: string[]): Promise<void>;
}

export type ChangeType = "add" | "change" | "delete";

export interface ITaskRunner {
    readonly needsUpdate: boolean;
    add(task: Task, inputs: string[]): TaskId;
    getInputs(id: TaskId): string[] | undefined;
    setInputs(id: TaskId, inputs: string[]): void;
    remove(id: TaskId): void;
    invalidatePath(path: string, type: ChangeType): void;
    update(): Promise<void>;
}

export function createTaskRunner(): ITaskRunner {
    return new TaskRunner();
}

class TaskRunner implements ITaskRunner {
    private _entryPoints: Map<string, TaskContext> = new Map();
    private _contextByDependency: Map<string, Set<TaskContext>> = new Map();
    private _invalidContexts: TaskContext[] = [];
    private _needsUpdate: boolean = false;

    public get needsUpdate(): boolean {
        return this._needsUpdate || this._invalidContexts.length > 0;
    }

    public add(task: Task, inputs: string[]): string {
        const context = new TaskContext(undefined, task, inputs);
        const id = randomUUID();
        this._entryPoints.set(id, context);
        this._invalidate([context]);

        return id;
    }

    public getInputs(id: TaskId): string[] | undefined {
        const ctx = this._entryPoints.get(id);

        if (ctx) {
            return [...ctx.inputs];
        }
    }

    public setInputs(id: TaskId, inputs: string[]): void {
        const ctx = this._entryPoints.get(id);

        if (ctx) {
            ctx.inputs.splice(0, ctx.inputs.length, ...inputs);
            this._invalidate([ctx]);
        }
    }

    public remove(id: string): void {
        const context = this._entryPoints.get(id);

        if (context) {
            this._prune(context);
            this._entryPoints.delete(id);

            this._needsUpdate = true;
        }
    }

    public invalidatePath(path: string, type: ChangeType): void {
        const contexts = this._contextByDependency.get(path);

        if (contexts) {
            if (type === "delete") {
                for (const context of contexts) {
                    removeFromArray(context.inputs, path);
                }
            }

            this._invalidate(contexts);
        }
    }

    public async update(): Promise<void> {
        this._needsUpdate = false;

        for (const context of [...this._invalidContexts]) {
            const { task, inputs } = context;

            this._prune(context);
            await task(context, inputs);
            this._gather(context);
            this._markValid(context);
        }
    }

    private _invalidate(contexts: Iterable<TaskContext>): void {
        let shouldCompact = false;

        for (const context of contexts) {
            let shouldAdd = true;

            for (let i = 0; i < this._invalidContexts.length; i++) {
                const invalid = this._invalidContexts[i];

                assert(invalid);

                if (context === invalid || context.isDescendantOf(invalid)) {
                    shouldAdd = false;
                    break;
                } else if (invalid.isDescendantOf(context)) {
                    this._invalidContexts[i] = context;
                    shouldCompact = true;
                    shouldAdd = false;
                }
            }

            if (shouldAdd) {
                this._invalidContexts.push(context);
            }
        }

        if (shouldCompact) {
            this._invalidContexts.splice(
                0,
                this._invalidContexts.length,
                ...new Set(this._invalidContexts),
            );
        }
    }

    private _markValid(context: TaskContext): void {
        for (const subTask of context.subTasks) {
            this._markValid(subTask);
        }

        removeFromArray(this._invalidContexts, context);
    }

    private _gather(context: TaskContext): void {
        for (const path of context.dependencies.union(
            new Set(context.inputs),
        )) {
            const item = this._contextByDependency.get(path);

            if (!item) {
                this._contextByDependency.set(path, new Set([context]));
            } else {
                item.add(context);
            }
        }

        for (const subTask of context.subTasks) {
            this._gather(subTask);
        }
    }

    private _prune(context: TaskContext): void {
        for (const subTask of context.subTasks) {
            this._prune(subTask);
        }

        for (const path of context.dependencies.union(
            new Set(context.inputs),
        )) {
            const item = this._contextByDependency.get(path);

            if (item) {
                if (item.delete(context)) {
                    if (item.size < 1) {
                        this._contextByDependency.delete(path);
                    }
                }
            }
        }

        context.subTasks.length = 0;
        this._markValid(context);
    }
}

class TaskContext implements ITaskContext {
    public parent: TaskContext | undefined;
    public readonly task: Task;
    public readonly inputs: string[];
    public readonly dependencies: Set<string> = new Set();
    public readonly subTasks: TaskContext[] = [];

    public constructor(
        parent: TaskContext | undefined,
        task: Task,
        inputs: string[],
    ) {
        this.parent = parent;
        this.task = task;
        this.inputs = inputs;
    }

    public dependOn(path: string): void {
        this.dependencies.add(path);
    }

    public async do(task: Task, inputs: string[]): Promise<void> {
        const context = new TaskContext(this, task, inputs);

        this.subTasks.push(context);
        await task(context, inputs);
    }

    public isDescendantOf(other: TaskContext): boolean {
        for (
            let curr: TaskContext | undefined = this.parent;
            curr;
            curr = curr.parent
        ) {
            if (other === this) {
                return true;
            }
        }

        return false;
    }
}

function removeFromArray<T>(array: T[], item: T): boolean {
    const index = array.indexOf(item);

    if (index >= 0) {
        array.splice(index, 1);
        return true;
    }

    return false;
}
