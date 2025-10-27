import assert from "node:assert";
import { extname as posixExtname } from "node:path/posix";
import mime from "mime";
import {
    createDocumentReference,
    type IDocumentReference,
} from "./DocumentReference.mjs";
import {
    fetchHTMLContent,
    getHTMLReferences,
    type IHTMLContent,
} from "./HTMLContent.mjs";
import type { ITypedDocumentReference } from "./internal.mjs";
import type { ISourceLocation } from "./SourceLocation.mjs";
import {
    fetchSVGContent,
    getSVGReferences,
    type ISVGContent,
} from "./SVGContent.mjs";
import type { IContent } from "./types.mjs";

/* node:coverage disable */
export enum CycleOptions {
    Allow = 0,
    Prune = 1,
    Fail = 2,
}

export interface IContentWalkerOptions {
    rootUrl: URL;
    followRemoteReferences?: boolean;
    ignoreNotFound?: boolean;
    cycles?: CycleOptions;
}

export type Content = IHTMLContent | ISVGContent | UnknownContent;

export interface IWalkEntry<T extends Content> {
    content: T;
    sourceLocation: ISourceLocation | undefined;
}

interface UnknownContent extends IContent {
    type: "unknown";
    mimeType: string;
    ref: IDocumentReference;
}

type ContentGetter<T extends Content> = (ref: IDocumentReference) => Promise<T>;

type ContentReferencesGetter<T extends Content> = (
    content: T,
) => AsyncIterable<ITypedDocumentReference>;
/* node:coverage enable */

export async function* walk(
    from: URL,
    type: string | undefined,
    options: IContentWalkerOptions,
): AsyncIterable<IWalkEntry<Content>> {
    if (typeof type !== "string") {
        type =
            mime.getType(posixExtname(from.pathname)) ??
            "application/octet-stream";
    }

    const entryPoint = createDocumentReference(from, options.rootUrl);

    yield* walkReference(undefined, type, entryPoint, options);
}

async function* walkReference(
    sourceLocation: ISourceLocation | undefined,
    type: string,
    to: IDocumentReference,
    options: IContentWalkerOptions,
): AsyncIterable<IWalkEntry<Content>> {
    const importChain: string[] = [];

    // Detect cycles
    for (
        let referrer = to.referrer;
        typeof referrer !== "undefined";
        referrer = referrer.referrer
    ) {
        importChain.push(referrer.url.href);

        if (referrer === to) {
            switch (options.cycles) {
                case CycleOptions.Allow: {
                    break;
                }
                case CycleOptions.Prune: {
                    return;
                }
                case CycleOptions.Fail: {
                    throw new Error(importChain.join(" < "));
                }
                default:
                    assert.fail();
            }
        }
    }

    switch (type) {
        case "text/html":
        case "application/xhtml+xml": {
            yield* getAndWalkContent(
                sourceLocation,
                to,
                fetchHTMLContent,
                getHTMLReferences,
                options,
            );
            break;
        }

        case "image/svg+xml": {
            yield* getAndWalkContent(
                sourceLocation,
                to,
                fetchSVGContent,
                getSVGReferences,
                options,
            );
            break;
        }

        // case "application/javascript": {
        //   yield* walkJavascriptContent(ref);
        //   break;
        // }

        default: {
            yield {
                content: {
                    type: "unknown",
                    mimeType: type,
                    ref: to,
                },
                sourceLocation: sourceLocation,
            };
        }
    }
}

async function* getAndWalkContent<T extends Content>(
    sourceLocation: ISourceLocation | undefined,
    ref: IDocumentReference,
    getter: ContentGetter<T>,
    referencesGetter: ContentReferencesGetter<T> | undefined,
    options: IContentWalkerOptions,
): AsyncIterable<IWalkEntry<Content>> {
    if (!options.followRemoteReferences && ref.url.protocol !== "file:") {
        return;
    }

    let content: T;

    try {
        content = await getter(ref);
    } catch (error) {
        if (
            options.ignoreNotFound &&
            isNodeError(error) &&
            (error.code === "ENOENT" || error.code === "EPERM")
        ) {
            return;
        }

        throw error;
    }

    yield {
        content: content,
        sourceLocation: sourceLocation,
    };

    if (referencesGetter) {
        for await (const {
            sourceLocation,
            type,
            ref: nextRef,
        } of referencesGetter(content)) {
            yield* walkReference(sourceLocation, type, nextRef, options);
        }
    }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return (
        error instanceof Error &&
        ("errno" in error ||
            "code" in error ||
            "path" in error ||
            "syscall" in error)
    );
}
