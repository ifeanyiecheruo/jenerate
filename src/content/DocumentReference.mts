import { relative as posixRelative } from "node:path/posix";
import { inspect } from "node:util";
import { getRelativeUrl, getUrlParts, UrlParts } from "../url.mjs";

/**
 * Handles all the subtelties of a URL referencing a resource from within a document
 * - Maintaining a base URL
 * - Maintaining a referrer
 * - Implementing policy preventing fetching from remote URL without throwing
 * - Normalizing the difference between ULRs and file paths
 *  - e.g path.join("/a/b", "c") === "/a/b/c" where-as new URL("c", filePathToURL("/a/b")) === new URL("/a/c") (notice ./b is dropped)
 */

/* node:coverage disable */
export interface IDocumentReference {
    readonly url: URL;
    readonly referrer: IDocumentReference | undefined;

    resolve(url: URL): IDocumentReference;
    resolve(path: string): IDocumentReference;
    resolve(urlOrPath: URL | string): IDocumentReference;
}

interface IDocumentReferenceContext {
    rootURL?: URL | undefined;
}
/* node:coverage enable */

export function createDocumentReference(
    url: URL,
    rootUrl?: URL | undefined,
): IDocumentReference {
    return new DocumentReference(url, undefined, { rootURL: rootUrl });
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

export function getRootRelativeUrl(ref: IDocumentReference): string {
    return getRelativeUrl(ref.resolve("/").url, ref.url);
}

class DocumentReference implements IDocumentReference {
    private _context: IDocumentReferenceContext;
    private _url: URL;
    private _referrer: IDocumentReference | undefined;

    public constructor(
        url: URL,
        referrer: IDocumentReference | undefined,
        context: IDocumentReferenceContext,
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

    public resolve(relOrAbsUrl: URL | string): IDocumentReference {
        if (typeof relOrAbsUrl === "string") {
            if (URL.canParse(relOrAbsUrl)) {
                return this.resolve(new URL(relOrAbsUrl));
            }

            if (
                this._context.rootURL &&
                hasSameUrlParts(
                    this._context.rootURL,
                    this._url,
                    UrlParts.Authority,
                )
            ) {
                const virtualUrl = new URL(
                    posixRelative(
                        this._context.rootURL.pathname,
                        this._url.pathname,
                    ),
                    "https://www.example.com",
                );
                const resolvedVirtualUrl = new URL(relOrAbsUrl, virtualUrl);
                const resolvedUrl = new URL(
                    `.${resolvedVirtualUrl.pathname}${resolvedVirtualUrl.search}${resolvedVirtualUrl.hash}`,
                    this._context.rootURL,
                );

                return new DocumentReference(resolvedUrl, this, this._context);
            } else {
                const resolvedUrl = new URL(relOrAbsUrl, this._url);

                return new DocumentReference(resolvedUrl, this, this._context);
            }
        } else {
            return new DocumentReference(relOrAbsUrl, this, this._context);
        }
    }

    [inspect.custom](_depth: number, _options: unknown): string {
        return this._url.href;
    }
}

function hasSameUrlParts(a: URL, b: URL, part: UrlParts): boolean {
    return getUrlParts(a, part) === getUrlParts(b, part);
}
