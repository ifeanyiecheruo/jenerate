import assert from "node:assert";
import { extname as posixExtname } from "node:path/posix";
import { pathToFileURL } from "node:url";
import mime from "mime";
import {
    createDocumentReference,
    type IDocumentReference,
    type ITypedDocumentReference,
} from "./DocumentReference.mjs";
import {
    fetchHTMLContent,
    getHTMLReferences,
    type IHTMLContent,
} from "./HTMLContent.mjs";
import {
    fetchSVGContent,
    getSVGReferences,
    type ISVGContent,
} from "./SVGContent.mjs";
import type { IContent } from "./types.mjs";

export enum CycleOptions {
    Allow = 0,
    Prune = 1,
    Fail = 2,
}

export interface IContentWalkerOptions {
    basePath: string;
    allowRemoteContent?: boolean;
    cycles?: CycleOptions;
}

interface UnknownContent extends IContent {
    type: "unknown";
    mimeType: string;
    ref: IDocumentReference;
}

export type Content = IHTMLContent | ISVGContent | UnknownContent;

type ContentGetter<T extends Content> = (
    ref: IDocumentReference,
) => Promise<T | undefined>;

type ContentReferencesGetter<T extends Content> = (
    content: T,
) => AsyncIterable<ITypedDocumentReference>;

export async function* walk(
    base: URL,
    root: URL,
    type: string | undefined,
    options: IContentWalkerOptions,
): AsyncIterable<Content> {
    if (typeof type !== "string") {
        type =
            mime.getType(posixExtname(root.pathname)) ??
            "application/octet-stream";
    }

    const entryPoint = createDocumentReference(base, {
        baseUrl: pathToFileURL(options.basePath),
    }).resolve(root.href);

    yield* walkReference(type, entryPoint, options);
}

async function* walkReference(
    type: string,
    ref: IDocumentReference,
    options: IContentWalkerOptions,
): AsyncIterable<Content> {
    const importChain: string[] = [];

    // Detect cycles
    for (
        let referrer = ref.referrer;
        typeof referrer !== "undefined";
        referrer = referrer.referrer
    ) {
        importChain.push(referrer.url.href);

        if (referrer === ref) {
            switch (options.cycles) {
                case CycleOptions.Allow: {
                    console.log("Following cycle");
                    break;
                }
                case CycleOptions.Prune: {
                    console.log("Pruning cycle");
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
                ref,
                fetchHTMLContent,
                getHTMLReferences,
                options,
            );
            break;
        }

        case "image/svg+xml": {
            yield* getAndWalkContent(
                ref,
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
                type: "unknown",
                mimeType: type,
                ref: ref,
            };
        }
    }
}

async function* getAndWalkContent<T extends Content>(
    ref: IDocumentReference,
    getter: ContentGetter<T>,
    referencesGetter: ContentReferencesGetter<T> | undefined,
    options: IContentWalkerOptions,
): AsyncIterable<Content> {
    const content = await getter(ref);
    if (typeof content === "undefined") {
        return;
    }

    yield content;

    if (referencesGetter) {
        for await (const { type, ref } of referencesGetter(content)) {
            yield* walkReference(type, ref, options);
        }
    }
}
