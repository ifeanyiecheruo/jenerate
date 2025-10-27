import type * as fs from "node:fs";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import type { JSDOM } from "jsdom";
import { getLocation } from "../dom.mjs";
import type { IDocumentReference } from "./DocumentReference.mjs";
import { type ISourceLocation, SourceLocation } from "./SourceLocation.mjs";

/* node:coverage disable */
type ExternalReferenceSchema = { [key: string]: readonly string[] };

type EXTERNAL_REFERENCE_TAG<T extends { [key: string]: readonly string[] }> =
    T[keyof T][number];

interface IExternalReference<T extends ExternalReferenceSchema> {
    sourceLocation: ISourceLocation;
    sourceTag: EXTERNAL_REFERENCE_TAG<T>;
    type: string | undefined;
    ref: IDocumentReference;
}

export interface ITypedDocumentReference {
    sourceLocation: ISourceLocation;
    type: string;
    ref: IDocumentReference;
}
/* node:coverage enable */

export async function* getExternalReferences<T extends ExternalReferenceSchema>(
    schema: T,
    dom: JSDOM,
    ref: IDocumentReference,
): AsyncIterable<IExternalReference<T>> {
    const {
        window: { document },
    } = dom;

    for (const [attr, tags] of Object.entries(schema)) {
        for (const tag of tags) {
            for (const element of getElementsByTagNameNS(document, tag)) {
                const attrNode = getAttribute(element, attr);
                const attrValue = attrNode?.nodeValue;

                if (typeof attrValue === "string") {
                    yield {
                        sourceLocation: new SourceLocation(
                            ref,
                            getLocation(dom, attrNode),
                        ),
                        sourceTag: tag,
                        type: element.getAttribute("type") ?? undefined,
                        ref: ref.resolve(attrValue),
                    };
                }
            }
        }
    }
}

function getElementsByTagNameNS(
    document: Document,
    tag: string,
): HTMLCollectionOf<Element> {
    const idx = tag.indexOf(":");

    if (idx >= 0) {
        return document.getElementsByTagNameNS(
            tag.substring(0, idx),
            tag.substring(idx + 1),
        );
    } else {
        return document.getElementsByTagName(tag);
    }
}

function getAttribute(element: Element, attr: string): Attr | null {
    const idx = attr.indexOf(":");

    if (idx >= 0) {
        return element.getAttributeNodeNS(
            attr.substring(0, idx),
            attr.substring(idx + 1),
        );
    } else {
        return element.getAttributeNode(attr);
    }
}

/* node:coverage disable */
export interface IFetchReferenceOptionsString {
    asBinary: false;
    fs?: typeof fs | undefined;
}

export interface IFetchReferenceOptionsBinary {
    asBinary: true;
    fs?: typeof fs | undefined;
}

export interface IFetchReferenceOptions {
    asBinary?: boolean | undefined;
    fs?: typeof fs | undefined;
}

export async function fetchReference(ref: IDocumentReference): Promise<string>;
export async function fetchReference(
    ref: IDocumentReference,
    options?: IFetchReferenceOptionsString | undefined,
): Promise<string>;
export async function fetchReference(
    ref: IDocumentReference,
    options?: IFetchReferenceOptionsBinary | undefined,
): Promise<ArrayBuffer>;
/* node:coverage enable */
export async function fetchReference(
    ref: IDocumentReference,
    options?: IFetchReferenceOptions,
): Promise<string | ArrayBuffer> {
    const encoding = options?.asBinary ? undefined : "utf-8";

    if (ref.url.protocol === "file:") {
        // fetch does not support file://
        const stream = createReadStream(fileURLToPath(ref.url), {
            flags: "r",
            encoding: encoding,
            fs: options?.fs,
        });

        const result: Array<Buffer | string> = [];

        for await (const item of stream) {
            result.push(item);
        }

        return options?.asBinary
            ? Buffer.concat(result as Buffer[]).buffer
            : result.join("");
    }

    const response = await fetch(ref.url);
    if (!response.ok) {
        throw new Error(
            `${response.url} ${response.status}: ${response.statusText}`,
        );
    }

    if (options?.asBinary) {
        return await response.arrayBuffer();
    } else {
        return await response.text();
    }
}
