import { parseArgs } from "node:util";

export interface ICLIOptions {
    from: string;
    to: string;
    inputs: string[];
    verbose?: boolean | undefined;
    watch?: boolean | undefined;
    updateDelayMs?: number | undefined;
}

export interface ICLIDefaults {
    updateDelayMs: number;
}

export function parseCommandLine(
    argv: string[],
    defaults: ICLIDefaults,
): ICLIOptions {
    const { values, positionals } = parseArgs({
        args: argv,
        tokens: false,
        allowPositionals: true,
        allowNegative: true,
        strict: true,
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
            "update-delay": {
                type: "string",
                short: "d",
                default: String(milliSecondsToSeconds(defaults.updateDelayMs)),
            },
        },
    });

    const { verbose, watch, from, to, "update-delay": updateDelayStr } = values;

    if (positionals.length < 1) {
        positionals.push("**/*.html");
    }

    if (typeof from !== "string") {
        help("--from required.");
    }

    if (typeof to !== "string") {
        help("--to required.");
    }

    const updateDelaySec = Number.parseFloat(updateDelayStr);
    if (!Number.isFinite(updateDelaySec)) {
        help("--update-delay must be a number.");
    }

    return {
        verbose: verbose,
        watch: watch,
        from: from,
        to: to,
        inputs: positionals,
        updateDelayMs: secondsToMilliSeconds(updateDelaySec),
    };
}

export function help(message: string): never {
    throw new Error(
        `${message}\njenerate [--verbose|-v] [--watch|-w] {--from|-f <src-path>} {--to|-t <destination-path>} [--update-delay|d <update-delay>] [<source-glob>+]`,
    );
}

function secondsToMilliSeconds(value: number): number {
    return value * 1000;
}

function milliSecondsToSeconds(value: number): number {
    return value / 1000;
}
