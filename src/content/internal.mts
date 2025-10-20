import type { IDocumentReference } from "./DocumentReference.mjs";

/* node:coverage disable */
type ExternalReferenceSchema = { [key: string]: readonly string[] };

type EXTERNAL_REFERENCE_TAG<T extends { [key: string]: readonly string[] }> =
    T[keyof T][number];

interface IExternalReference<T extends ExternalReferenceSchema> {
    tag: EXTERNAL_REFERENCE_TAG<T>;
    type: string | undefined;
    ref: IDocumentReference;
}
/* node:coverage enable */

export async function* getExternalReferences<T extends ExternalReferenceSchema>(
    schema: T,
    document: Document,
    ref: IDocumentReference,
): AsyncIterable<IExternalReference<T>> {
    for (const [attr, tags] of Object.entries(schema)) {
        for (const tag of tags) {
            for (const element of getElementsByTagNameNS(document, tag)) {
                const attrValue = getAttribute(element, attr);

                if (typeof attrValue === "string") {
                    yield {
                        tag: tag,
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

function getAttribute(element: Element, attr: string): string | null {
    const idx = attr.indexOf(":");

    if (idx >= 0) {
        return element.getAttributeNS(
            attr.substring(0, idx),
            attr.substring(idx + 1),
        );
    } else {
        return element.getAttribute(attr);
    }
}
