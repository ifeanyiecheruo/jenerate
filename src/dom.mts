import type { JSDOM } from "jsdom";

enum NodeType {
    ELEMENT_NODE = 1,
    ATTRIBUTE_NODE = 2,
    TEXT_NODE = 3,
}

export interface NodeLocation {
    startLine: number;
    startCol: number;
    startOffset: number;
    endLine: number;
    endCol: number;
    endOffset: number;
}

interface ElementNodeLocation {
    startLine: number;
    startCol: number;
    attrs?: Record<string, NodeLocation>;
}

export function getLocation(
    dom: JSDOM,
    node: Node | null | undefined,
): NodeLocation | undefined {
    let location: NodeLocation | null | undefined;

    if (node) {
        switch (node.nodeType) {
            case NodeType.ATTRIBUTE_NODE: {
                const { ownerElement } = node as Attr;

                if (ownerElement) {
                    const parentLocation:
                        | ElementNodeLocation
                        | null
                        | undefined = dom.nodeLocation(ownerElement);

                    if (parentLocation?.attrs) {
                        location = parentLocation.attrs[node.nodeName];
                    }
                }

                if (!location) {
                    location = dom.nodeLocation(node);
                }

                break;
            }

            default: {
                location = dom.nodeLocation(node);
                break;
            }
        }
    }

    return location ? location : undefined;
}
