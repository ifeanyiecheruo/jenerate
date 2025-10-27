import type { NodeLocation } from "../dom.mjs";
import {
    getRootRelativeUrl,
    type IDocumentReference,
} from "./DocumentReference.mjs";

export interface ISourceLocation {
    readonly ref: IDocumentReference;
    readonly location: NodeLocation | null | undefined;
}

export class SourceLocation implements ISourceLocation {
    public readonly ref: IDocumentReference;
    public readonly location: NodeLocation | null | undefined;

    public constructor(
        ref: IDocumentReference,
        location?: NodeLocation | null | undefined,
    ) {
        this.ref = ref;
        this.location = location;
    }

    public toString(): string {
        return this.location
            ? `${getRootRelativeUrl(this.ref)}:${getLocationString(this.location)}`
            : getRootRelativeUrl(this.ref);
    }
}

function getLocationString(location: NodeLocation | null | undefined): string {
    return location ? `${location.startLine}:${location.startCol}` : "";
}
