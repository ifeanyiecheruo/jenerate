type DebounceCallback = (...args: unknown[]) => void;

export function debounce<T extends DebounceCallback>(
    value: T,
    delayMs: number,
    signal?: AbortSignal | undefined,
): T {
    let timerId: ReturnType<typeof setTimeout> | undefined;

    if (signal) {
        signal.addEventListener(
            "abort",
            () => {
                if (typeof timerId !== "undefined") {
                    clearTimeout(timerId);
                    timerId = undefined;
                }
            },
            { once: true },
        );
    }

    return ((...args: Parameters<T>): void => {
        if (typeof timerId !== "undefined") {
            clearTimeout(timerId);
            timerId = undefined;
        }

        if (signal?.aborted) {
            return;
        }

        timerId = setTimeout(() => {
            value(...args);
            timerId = undefined;
        }, delayMs);
    }) as T;
}
