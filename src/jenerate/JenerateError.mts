export class JenerateError extends Error {
    constructor(message = "", ...args: Array<ErrorOptions | undefined>) {
        super(message, ...args);
    }
}

JenerateError.prototype.name = "JenerateError";
