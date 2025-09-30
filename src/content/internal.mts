import { Mime } from "mime";
import type { IDocumentReference } from "./DocumentReference.mjs";

export const mime = new Mime();

type ExternalReferenceSchema = { [key: string]: readonly string[] };

type EXTERNAL_REFERENCE_TAG<T extends { [key: string]: readonly string[] }> =
    T[keyof T][number];

interface IExternalReference<T extends ExternalReferenceSchema> {
    tag: EXTERNAL_REFERENCE_TAG<T>;
    type: string | undefined;
    ref: IDocumentReference;
}

export async function* getExternalReferences<T extends ExternalReferenceSchema>(
    schema: T,
    document: Document,
    ref: IDocumentReference,
): AsyncIterable<IExternalReference<T>> {
    for (const [attr, tags] of Object.entries(schema)) {
        for (const tag of tags) {
            for (const element of document.getElementsByTagName(tag)) {
                const attrValue = element.getAttribute(attr);
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
