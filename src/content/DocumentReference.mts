import { createReadStream } from "node:fs";
import { isAbsolute as isAbsolutePath } from "node:path";
import { sep as posixPathSep } from "node:path/posix";
import { sep as win32PathSep } from "node:path/win32";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Handles all the subtelties of a URL referencing a resource from within a document
 * - Maintaining a base URL
 * - Maintaining a referrer
 * - Implementing policy preventing fetching from remote URL without throwing
 * - Normalizing the difference between ULRs and file paths
 *  - e.g path.join("/a/b", "c") === "/a/b/c" where-as new URL("c", filePathToURL("/a/b")) === new URL("/a/c") (notice ./b is dropped)
 */
export interface IDocumentReference {
    readonly url: URL;
    readonly referrer: IDocumentReference | undefined;

    fetch(): Promise<string | undefined>;
    fetch(asBinary: false): Promise<string | undefined>;
    fetch(asBinary: true): Promise<ArrayBuffer | undefined>;
    fetch(asBinary?: boolean): Promise<string | ArrayBuffer | undefined>;

    resolve(url: URL): IDocumentReference;
    resolve(path: string): IDocumentReference;
    resolve(urlOrPath: URL | string): IDocumentReference;
}

export interface ITypedDocumentReference {
    type: string;
    ref: IDocumentReference;
}

interface IResolveContext {
    baseUrl: URL;
    allowRemoteFetch?: boolean | undefined;
}

export interface IDocumentReferenceOptions {
    baseUrl: URL;
}

export function createDocumentReference(
    url: URL,
    options: IDocumentReferenceOptions,
): IDocumentReference {
    return new DocumentReference(url, undefined, {
        baseUrl: options.baseUrl,
    });
}

export function getRootReferrer(
    ref: IDocumentReference,
): IDocumentReference | undefined {
    let result = ref.referrer;
    while (result?.referrer) {
        result = result.referrer;
    }

    return result;
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

    public resolve(urlOrPath: URL | string): IDocumentReference {
        if (typeof urlOrPath === "string") {
            const path = urlOrPath.replaceAll(win32PathSep, posixPathSep);

            if (path.startsWith(posixPathSep)) {
                if (isSubResource(this._context.baseUrl, this._url)) {
                    return new DocumentReference(
                        new URL(`.${path}`, this._context.baseUrl),
                        this,
                        this._context,
                    );
                } else {
                    return new DocumentReference(
                        new URL(pathToFileURL(path), this._url),
                        this,
                        this._context,
                    );
                }
            } else if (isAbsolutePath(urlOrPath)) {
                return new DocumentReference(
                    new URL(pathToFileURL(path), this._url),
                    this,
                    this._context,
                );
            } else {
                return this.resolve(new URL(path, this._url));
            }
        } else {
            return new DocumentReference(urlOrPath, this, this._context);
        }
    }

    public toString(): string {
        return this._url.protocol === "file:"
            ? fileURLToPath(this._url)
            : this._url.toString();
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

function getAuthorityAndPathname(url: URL): string {
    const { origin, username, password, pathname } = url;

    if (username !== "") {
        if (password !== "") {
            return `${origin}@${username}:${password}/${pathname}`;
        } else {
            return `${origin}@${username}/${pathname}`;
        }
    } else {
        if (password !== "") {
            return `${origin}@:${password}/${pathname}`;
        } else {
            return `${origin}/${pathname}`;
        }
    }
}

function isSubResource(parent: URL, child: URL): boolean {
    const parentHref = getAuthorityAndPathname(parent);
    const childHref = getAuthorityAndPathname(child);

    return (
        childHref.startsWith(parentHref) &&
        (childHref.length === parentHref.length ||
            childHref[parentHref.length] === "/")
    );
}
