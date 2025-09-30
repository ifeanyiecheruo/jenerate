import { createReadStream } from "node:fs";
import {
    dirname as posixDirname,
    relative as relativePosixPath,
} from "node:path/posix";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface IDocumentReference {
    readonly url: URL;
    readonly referrer: IDocumentReference | undefined;

    fetch(): Promise<string | undefined>;
    fetch(asBinary: false): Promise<string | undefined>;
    fetch(asBinary: true): Promise<ArrayBuffer | undefined>;
    fetch(asBinary?: boolean): Promise<string | ArrayBuffer | undefined>;

    resolve(url: string): IDocumentReference;
}

export interface ITypedDocumentReference {
    type: string;
    ref: IDocumentReference;
}

interface IResolveContext {
    rootPath: string;
    allowRemoteFetch?: boolean | undefined;
}

export interface IDocumentReferenceOptions {
    rootPath: string;
}

export function createDocumentReference(
    url: URL,
    options: IDocumentReferenceOptions,
): IDocumentReference {
    return new DocumentReference(createUrl(url.href), undefined, {
        rootPath: options.rootPath,
    });
}

export function relativePath(
    from: IDocumentReference | undefined,
    to: IDocumentReference | string,
): string | undefined {
    if (typeof to === "string") {
        return from ? relativePath(from, from.resolve(to)) : to;
    }

    if (from) {
        if (getAuthority(from.url) === getAuthority(to.url)) {
            return (
                relativePosixPath(
                    posixDirname(from.url.pathname),
                    to.url.pathname,
                ) + to.url.search
            );
        }
    }
}

class DocumentReference implements IDocumentReference {
    private _context: IResolveContext;
    private _url: URL;
    private _referrer: IDocumentReference | undefined;

    public constructor(
        url: URL,
        referrer: IDocumentReference | undefined,
        context: IResolveContext,
    ) {
        this._url = url;
        this._referrer = referrer;
        this._context = context;
    }

    public get url(): URL {
        return this._url;
    }

    public get referrer(): IDocumentReference | undefined {
        return this._referrer;
    }

    public resolve(url: string): IDocumentReference {
        if (URL.canParse(url)) {
            return new DocumentReference(createUrl(url), this, this._context);
        }

        if (url.startsWith("/")) {
            return new DocumentReference(
                new URL(`.${url}`, pathToFileURL(this._context.rootPath)),
                this,
                this._context,
            );
        } else {
            return new DocumentReference(
                new URL(url, this._url),
                this,
                this._context,
            );
        }
    }

    public toString(): string {
        let rootReferrer = this.referrer;
        while (rootReferrer?.referrer) {
            rootReferrer = rootReferrer.referrer;
        }

        const result = relativePath(rootReferrer, this);

        if (typeof result === "string") {
            return result;
        }

        return this.url.protocol === "file:"
            ? fileURLToPath(this.url)
            : this.url.toString();
    }

    fetch(): Promise<string | undefined>;
    fetch(asBinary: false): Promise<string | undefined>;
    fetch(asBinary: true): Promise<ArrayBuffer | undefined>;
    public async fetch(
        asBinary?: boolean,
    ): Promise<string | ArrayBuffer | undefined> {
        const encoding = asBinary ? undefined : "utf-8";

        if (this._url.protocol === "file:") {
            const stream = createReadStream(fileURLToPath(this._url), {
                flags: "r",
                encoding: encoding,
            });

            const result: Array<Buffer | string> = [];

            for await (const item of stream) {
                result.push(item);
            }

            return asBinary
                ? Buffer.concat(result as Buffer[]).buffer
                : result.join("");
        }

        if (this._context.allowRemoteFetch) {
            const response = await fetch(this._url);
            if (!response.ok) {
                throw new Error(
                    `${response.url} ${response.status}: ${response.statusText}`,
                );
            }

            return (await asBinary) ? response.arrayBuffer() : response.text();
        }
    }
}

function getAuthority(url: URL): string {
    const { origin, username, password } = url;

    if (username !== "") {
        if (password !== "") {
            return `${origin}@${username}:${password}`;
        } else {
            return `${origin}@${username}`;
        }
    } else {
        if (password !== "") {
            return `${origin}@:${password}`;
        } else {
            return origin;
        }
    }
}

function createUrl(url: string): URL {
    const candiate = new URL(url);

    return candiate.protocol.length > 2
        ? candiate
        : new URL(pathToFileURL(url));
}
