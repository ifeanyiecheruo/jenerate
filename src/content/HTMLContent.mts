import { extname as posixExtname } from "node:path/posix";
import { JSDOM } from "jsdom";
import mime from "mime";
import type { IDocumentReference } from "./DocumentReference.mjs";
import {
    fetchReference,
    getExternalReferences,
    type ITypedDocumentReference,
} from "./internal.mjs";
import type { IContent } from "./types.mjs";

export interface IHTMLContent extends IContent {
    type: "html";
    mimeType: "text/html" | "application/xhtml+xml";
    dom: JSDOM;
    ref: IDocumentReference;
}

const HTML_EXTERNAL_REFERENCE_SCHEMA = {
    href: ["a", "link"],
    src: ["img", "script", "iframe", "audio", "video", "source", "embed"],
    data: ["object"],
    poster: ["video"],
} as const;

export async function fetchHTMLContent(
    ref: IDocumentReference,
): Promise<IHTMLContent> {
    const dom = new JSDOM(await fetchReference(ref), {
        url: ref.url.href,
        contentType: "text/html",
        referrer: ref.referrer?.url.href,
        storageQuota: 0,
        includeNodeLocations: true,
        // runScripts: "dangerously",
    });

    return {
        type: "html",
        mimeType: "text/html",
        dom: dom,
        ref: ref,
    };
}

export async function* getHTMLReferences(
    content: IHTMLContent,
): AsyncIterable<ITypedDocumentReference> {
    for await (const {
        sourceLocation,
        sourceTag,
        type,
        ref,
    } of getExternalReferences(
        HTML_EXTERNAL_REFERENCE_SCHEMA,
        content.dom,
        content.ref,
    )) {
        let resolvedType = type;

        if (typeof resolvedType !== "string") {
            switch (sourceTag) {
                case "script": {
                    resolvedType = "application/javascript";
                    break;
                }

                default: {
                    resolvedType =
                        mime.getType(posixExtname(ref.url.pathname)) ??
                        "application/octet-stream";
                    break;
                }
            }
        }

        yield { sourceLocation, type: resolvedType, ref };
    }
}
