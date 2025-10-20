import { extname as posixExtname } from "node:path/posix";
import { JSDOM } from "jsdom";
import mime from "mime";
import type {
    IDocumentReference,
    ITypedDocumentReference,
} from "./DocumentReference.mjs";
import { getExternalReferences } from "./internal.mjs";
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
    dom: Document;
    ref: IDocumentReference;
}

export async function fetchSVGContent(
    ref: IDocumentReference,
): Promise<ISVGContent | undefined> {
    const fetched = await ref.fetch();

    if (typeof fetched === "undefined") {
        return;
    }

    const { DOMParser } = new JSDOM("<!DOCTYPE html>", {
        includeNodeLocations: true,
    }).window;
    const parser = new DOMParser();
    const dom = parser.parseFromString(fetched, "image/svg+xml");

    return {
        type: "svg",
        mimeType: "image/svg+xml",
        dom: dom,
        ref: ref,
    };
}

export async function* getSVGReferences(
    content: ISVGContent,
): AsyncIterable<ITypedDocumentReference> {
    for await (const { tag, type, ref: externalRef } of getExternalReferences(
        SVG_EXTERNAL_REFERENCE_SCHEMA,
        content.dom,
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
