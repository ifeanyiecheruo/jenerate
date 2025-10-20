import { extname as posixExtname } from "node:path/posix";
import { JSDOM } from "jsdom";
import mime from "mime";
import type {
    IDocumentReference,
    ITypedDocumentReference,
} from "./DocumentReference.mjs";
import { getExternalReferences } from "./internal.mjs";
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
): Promise<IHTMLContent | undefined> {
    const fetched = await ref.fetch();

    if (typeof fetched === "undefined") {
        return;
    }

    const dom = new JSDOM(fetched, {
        url: ref.url.href,
        contentType: "text/html",
        referrer: ref.referrer?.url.href,
        storageQuota: 0,
        includeNodeLocations: true,
        runScripts: "dangerously",
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
    for await (const { tag, type, ref: externalRef } of getExternalReferences(
        HTML_EXTERNAL_REFERENCE_SCHEMA,
        content.dom.window.document,
        content.ref,
    )) {
        let resolvedType = type;

        if (typeof resolvedType !== "string") {
            switch (tag) {
                case "script": {
                    resolvedType = "application/javascript";
                    break;
                }

                default: {
                    resolvedType =
                        mime.getType(posixExtname(externalRef.url.pathname)) ??
                        "application/octet-stream";
                    break;
                }
            }
        }

        yield { type: resolvedType, ref: externalRef };
    }
}
