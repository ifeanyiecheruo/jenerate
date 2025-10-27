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

const SVG_EXTERNAL_REFERENCE_SCHEMA = {
    href: ["a", "feImage", "image", "script", "use"],
    "http://www.w3.org/1999/xlink:href": [
        "a",
        "feImage",
        "image",
        "script",
        "use",
    ],
} as const;

export interface ISVGContent extends IContent {
    type: "svg";
    mimeType: "image/svg+xml";
    dom: JSDOM;
    document: Document;
    ref: IDocumentReference;
}

export async function fetchSVGContent(
    ref: IDocumentReference,
): Promise<ISVGContent> {
    const dom = new JSDOM("<!DOCTYPE html>", {
        url: ref.url.href,
        contentType: "text/html",
        referrer: ref.referrer?.url.href,
        storageQuota: 0,
        includeNodeLocations: true,
        runScripts: undefined,
    });
    const {
        window: { DOMParser },
    } = dom;
    const document = new DOMParser().parseFromString(
        await fetchReference(ref),
        "image/svg+xml",
    );

    return {
        type: "svg",
        mimeType: "image/svg+xml",
        dom: dom,
        document: document,
        ref: ref,
    };
}

export async function* getSVGReferences(
    content: ISVGContent,
): AsyncIterable<ITypedDocumentReference> {
    for await (const {
        sourceLocation,
        sourceTag,
        type,
        ref,
    } of getExternalReferences(
        SVG_EXTERNAL_REFERENCE_SCHEMA,
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
