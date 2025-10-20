import assert from "node:assert";

/* node:coverage disable */
export function debounce(
    value: () => void,
    delayMs: number,
    maxDelayMs: number,
): () => void;
export function debounce(
    value: (signal: AbortSignal) => void,
    delayMs: number,
    maxDelayMs: number,
    signal: AbortSignal,
): () => void;
export function debounce(
    value: (signal?: AbortSignal | undefined) => void,
    delayMs: number,
    maxDelayMs: number,
    signal?: AbortSignal | undefined,
): () => void;
/* node:coverage enable */
export function debounce<T extends (signal?: AbortSignal | undefined) => void>(
    value: T,
    delayMs: number,
    maxDelayMs: number,
    signal?: AbortSignal | undefined,
): () => void {
    let timerId: ReturnType<typeof setTimeout> | undefined;
    let deadline = 0;
    signal?.addEventListener("abort", cleanup, { once: true });

    return function callback(): void {
        if (typeof timerId !== "undefined") {
            if (signal?.aborted) {
                cleanup();
                checkSignal(signal);
                return;
            }

            const canExtendTimeout = Date.now() < deadline;
            if (canExtendTimeout) {
                cleanup();
                setup();
            }
        } else {
            if (checkSignal(signal)) {
                return;
            }

            setup();
            deadline = Date.now() + maxDelayMs;
        }
    };

    function cleanup() {
        if (typeof timerId !== "undefined") {
            clearTimeout(timerId);
            timerId = undefined;
        }
    }

    function setup() {
        assert(typeof timerId === "undefined");

        timerId = setTimeout(() => {
            timerId = undefined;

            // There is no point throwing an exception if the signal aborted with a reason because
            // (a) there is no user code on the stack to observe it
            // (b) the error is not about a failure in user code, its just a signal
            // so dont replace this with `if (checkSignal(signal)) {}`
            if (!signal?.aborted) {
                value(signal);
            }
        }, delayMs);
    }
}

/* node:coverage disable */
export function debounceAsync(
    value: () => Promise<void>,
    delayMs: number,
    maxDelayMs: number,
): () => Promise<void>;
export function debounceAsync(
    value: (signal: AbortSignal) => Promise<void>,
    delayMs: number,
    maxDelayMs: number,
    signal: AbortSignal,
): () => Promise<void>;
export function debounceAsync(
    value: (signal?: AbortSignal | undefined) => Promise<void>,
    delayMs: number,
    maxDelayMs: number,
    signal?: AbortSignal | undefined,
): () => Promise<void>;
/* node:coverage enable */
export function debounceAsync<
    T extends (signal?: AbortSignal | undefined) => Promise<void>,
>(
    value: T,
    delayMs: number,
    maxDelayMs: number,
    signal?: AbortSignal | undefined,
): () => Promise<void> {
    const resolveQueue: Array<() => void> = [];
    let busy = false;
    let pendingCount = 0;
    let promise = Promise.resolve();

    const scheduleEndWait = debounce(
        function endWait() {
            const resolve = resolveQueue.shift();
            if (resolve) {
                resolve();
            }
        },
        delayMs,
        maxDelayMs,
        signal,
    );

    signal?.addEventListener("abort", cleanup, { once: true });

    return async function callback(): Promise<void> {
        if (signal?.aborted) {
            cleanup();
            checkSignal(signal);
            return;
        }

        let shouldRun = false;

        if (busy) {
            if (pendingCount < 1) {
                shouldRun = true;
            }

            pendingCount++;
        } else if (resolveQueue.length < 1) {
            shouldRun = true;
        }

        if (shouldRun) {
            promise = promise.finally(() => {
                scheduleEndWait();

                return run();
            });
        } else {
            scheduleEndWait();
        }

        await promise;
    };

    function run(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (signal?.aborted) {
                cleanup();

                if (typeof signal.reason !== "undefined") {
                    reject(signal.reason);
                } else {
                    resolve();
                }
            } else {
                resolveQueue.push(resolve);
            }
        })
            .finally(() => {
                if (checkSignal(signal)) {
                    return;
                }

                pendingCount = 0;
                busy = true;
                return value(signal);
            })
            .finally(() => {
                busy = false;
                pendingCount = 0;
            });
    }

    function cleanup() {
        for (
            let item = resolveQueue.shift();
            item;
            item = resolveQueue.shift()
        ) {
            item();
        }
    }
}

function checkSignal(signal?: AbortSignal | undefined): boolean {
    if (signal?.aborted) {
        if (typeof signal.reason !== "undefined") {
            throw signal.reason;
        }

        return true;
    }

    return false;
}
