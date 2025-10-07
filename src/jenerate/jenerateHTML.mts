import assert from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import {
    dirname as posixDirname,
    relative as relativePosixPath,
} from "node:path/posix";
import { fileURLToPath, pathToFileURL } from "node:url";
import ejs from "ejs";
import { JSDOM } from "jsdom";
import pretty from "pretty";
import {
    fetchCSVContent,
    fetchHTMLContent,
    getRootReferrer,
    type ICSVContent,
    type IDocumentReference,
    type IHTMLContent,
    walk,
} from "../content/index.mjs";
import { JenerateError } from "./JenerateError.mjs";

const DOCUMENT_POSITION_FOLLOWING = 4;
const DOCUMENT_POSITION_PRECEDING = 2;
const ATTRIBUTE_NODE = 2;
const SNIPPET_TAG_NAME = "x-jen-snippet";
const FROM_DATA_TAG_NAME = "x-jen-from-data";

interface NodeLocation {
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

export interface IJenerateHTMLOptions {
    from: string;
    to: string;
    base: string;
    signal?: AbortSignal | undefined;
}

export async function jenerateHTML(
    options: IJenerateHTMLOptions,
): Promise<{ dependencies: Set<URL>; assets: Set<URL> }> {
    const fullBasePath = resolvePath(options.base);
    const srcUrl = pathToFileURL(resolvePath(options.from));
    const contentIterator = walk(
        pathToFileURL(fullBasePath),
        srcUrl,
        "text/html",
        {
            basePath: dirname(fullBasePath),
        },
    );

    const dependecies: Set<URL> = new Set();
    const assets: Set<URL> = new Set();

    for await (const content of contentIterator) {
        if (options.signal?.aborted) {
            break;
        }

        switch (content.type) {
            case "html": {
                if (content.ref.url.href === srcUrl.href) {
                    // We have walked to the document we were asked to jenerate
                    // expand any jen-* directives and write the file to disk
                    await expandDocumentFromContent(content, dependecies, {});

                    const domString = pretty(content.dom.serialize(), {
                        ocd: true,
                    });

                    await mkdir(dirname(options.to), { recursive: true });
                    await writeFile(options.to, domString, {
                        encoding: "utf-8",
                    });
                } else {
                    dependecies.add(content.ref.url);
                }

                break;
            }

            default: {
                assets.add(content.ref.url);
                break;
            }
        }
    }

    return { dependencies: dependecies, assets: assets };
}

async function expandDocumentFromContent(
    content: IHTMLContent,
    dependencies: Set<URL>,
    env: Record<string, unknown>,
): Promise<void> {
    const workItems: Array<{
        target: Element;
        callback: (
            dom: JSDOM,
            target: Element,
            context: IDocumentReference,
            dependecies: Set<URL>,
            env: Record<string, unknown>,
        ) => Promise<void>;
    }> = [];

    // Find a all the jen-* directives and queue them up for processing
    for (const element of content.dom.window.document.getElementsByTagName(
        FROM_DATA_TAG_NAME,
    )) {
        workItems.push({ target: element, callback: processForEach });
    }

    for (const element of content.dom.window.document.head.getElementsByTagName(
        "link",
    )) {
        if (element.getAttribute("rel") === SNIPPET_TAG_NAME) {
            workItems.push({ target: element, callback: processRelSnippet });
        }
    }

    for (const element of content.dom.window.document.body.getElementsByTagName(
        SNIPPET_TAG_NAME,
    )) {
        workItems.push({ target: element, callback: processSnippet });
    }

    // Since the queued work items mutate DOM nodes it is important we do the mutation
    // from the bottom of the document to the top of the document to minimize the
    // potential for an early mutation to have a side-effect on later content.
    workItems.sort((a, b) => -compareDOMNodes(a.target, b.target));

    for (const { target, callback } of workItems) {
        await callback(content.dom, target, content.ref, dependencies, env);
    }

    dependencies.add(content.ref.url);

    return;
}

async function processSnippet(
    dom: JSDOM,
    target: Element,
    ref: IDocumentReference,
    dependencies: Set<URL>,
    env: Record<string, unknown>,
): Promise<void> {
    return await processSnippetImpl(dom, target, "src", ref, dependencies, env);
}

async function processRelSnippet(
    dom: JSDOM,
    target: Element,
    ref: IDocumentReference,
    dependencies: Set<URL>,
    env: Record<string, unknown>,
): Promise<void> {
    return await processSnippetImpl(
        dom,
        target,
        "href",
        ref,
        dependencies,
        env,
    );
}

async function processForEach(
    dom: JSDOM,
    target: Element,
    ref: IDocumentReference,
    dependencies: Set<URL>,
    env: Record<string, unknown>,
): Promise<void> {
    const src = target.getAttribute("src");

    if (typeof src === "string") {
        const location = getLocation(dom, target);
        let csvContent: ICSVContent | undefined;

        try {
            csvContent = await fetchCSVContent(ref.resolve(src));
        } catch (error) {
            throwJenerateError(ref, location, error);
        }

        if (typeof csvContent !== "undefined") {
            const refString = getRootRelativePath(ref);
            const selectAttr = target.getAttributeNode("select");
            const select = selectAttr?.nodeValue?.trim();

            if (!selectAttr) {
                throw new JenerateError(
                    [
                        `${refString}${getLocationString(location)} - No columns selected.`,
                        `You must use a 'select' attribute to say which columns from ${src} you want to use in your template`,
                        `Available columns in ${src} are`,
                        ...csvContent.headers.map((item) => `\t- ${item}`),
                    ].join("\n"),
                );
            }

            const selectLocation = getLocationString(
                getLocation(dom, selectAttr),
            );

            let outerHtml: string = "";
            const selectedColumns = (typeof select === "string" ? select : "")
                .split(",")
                .map((item) => item.trim())
                .filter((item) => item.length > 0);

            const unknownSelection = selectedColumns.filter(
                (col) => !csvContent.headers.includes(col),
            );

            if (unknownSelection.length > 0) {
                throw new JenerateError(
                    [
                        `${refString}${selectLocation} - Selected column not found.`,
                        `The following selected columns were not found in ${src}`,
                        ...unknownSelection.map((item) => `\t- ${item}`),
                        `Available columns in ${src} are`,
                        ...csvContent.headers.map((item) => `\t- ${item}`),
                    ].join("\n"),
                );
            }

            const templateParameters = getEJSTemplateParameters(dom, target);
            const unselectedParams = Object.entries(templateParameters)
                .filter(([column]) => !selectedColumns.includes(column))
                .map(
                    ([column, location]) =>
                        `\t${column} - ${refString}${getLocationString(location)}`,
                );

            if (unselectedParams.length > 0) {
                throw new JenerateError(
                    [
                        `${refString} - The following name(s) are used in a template without first being selected`,
                        ...unselectedParams,
                        `Fix the spelling of the name(s) in the template or add the problematic name(s) to the 'select' attribute at ${refString}${selectLocation}`,
                    ].join("\n"),
                );
            }

            for (const row of csvContent.rows) {
                const rowEnv = { ...env, ...row };
                const rowDom = new JSDOM(
                    ejs.render(
                        target.innerHTML.replaceAll(
                            /&lt;%=\s*(.*?)\s*%&gt;/g,
                            "<%= $1 %>",
                        ),
                        rowEnv,
                    ),
                    {
                        includeNodeLocations: true,
                    },
                );

                await expandDocumentFromContent(
                    {
                        type: "html",
                        mimeType: "text/html",
                        dom: rowDom,
                        ref: ref,
                    },
                    dependencies,
                    rowEnv,
                );

                outerHtml += rowDom.serialize();
            }

            dependencies.add(csvContent.ref.url);
            target.outerHTML = outerHtml;

            return;
        }
    }

    target.remove();
}

async function processSnippetImpl(
    dom: JSDOM,
    target: Element,
    srcAttr: string,
    ref: IDocumentReference,
    dependencies: Set<URL>,
    env: Record<string, unknown>,
): Promise<void> {
    const srcNode = target.getAttributeNode(srcAttr);
    const src = srcNode?.value;

    if (typeof src === "string") {
        let content: IHTMLContent | undefined;

        const srcRef = ref.resolve(src);
        try {
            content = await fetchHTMLContent(srcRef);
        } catch (error) {
            throwJenerateError(ref, getLocation(dom, srcNode), error);
        }

        if (typeof content !== "undefined") {
            await expandDocumentFromContent(content, dependencies, env);

            target.outerHTML = content.dom.serialize();

            return;
        }
    }

    target.remove();
}

function compareDOMNodes(a: Node, b: Node): number {
    const following =
        a.compareDocumentPosition(b) & DOCUMENT_POSITION_FOLLOWING;
    if (following) {
        return -1; // 'a' comes before 'b'
    }

    const preceeding =
        a.compareDocumentPosition(b) & DOCUMENT_POSITION_PRECEDING;
    if (preceeding) {
        return 1; // 'a' comes after 'b'
    }

    return 0; // Elements are the same or not in the same document
}

function getEJSTemplateParameters(
    dom: JSDOM,
    container: Element,
): Record<string, NodeLocation | undefined> {
    const expressions: RegExp[] = [
        /<%=\s*(.*?)\s*%>/g,
        /&lt;%=\s*(.*?)\s*%&gt;/g,
    ];

    const result: Record<string, NodeLocation | undefined> = {};
    for (const node of walkTextNodes(dom, container)) {
        const text = node.nodeValue;

        if (typeof text === "string") {
            for (const expr of expressions) {
                for (
                    let found = expr.exec(text);
                    found !== null;
                    found = expr.exec(text)
                ) {
                    const capture = found[1];

                    assert(typeof capture === "string");

                    result[capture] = getLocation(dom, node);
                }
            }
        }
    }

    return result;
}

function* walkTextNodes(dom: JSDOM, root: Node): Iterable<Node> {
    const ELEMENT_NODE = 1;
    const TEXT_NODE = 3;

    const treeWalker = dom.window.document.createTreeWalker(
        root,
        dom.window.NodeFilter.SHOW_TEXT | dom.window.NodeFilter.SHOW_ELEMENT,
        null,
    );

    for (let node = treeWalker.nextNode(); node; node = treeWalker.nextNode()) {
        switch (node.nodeType) {
            case TEXT_NODE: {
                yield node;
                break;
            }

            case ELEMENT_NODE: {
                const { attributes } = node as Element;
                for (let i = 0; i < attributes.length; i++) {
                    const attribute = attributes.item(i);
                    if (attribute) {
                        yield attribute;
                    }
                }
                break;
            }

            default: {
                assert.fail();
            }
        }
    }
}

function getLocation(
    dom: JSDOM,
    node: Node | null | undefined,
): NodeLocation | undefined {
    let location: NodeLocation | null | undefined;

    if (node) {
        switch (node.nodeType) {
            case ATTRIBUTE_NODE: {
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

function getLocationString(location: NodeLocation | null | undefined): string {
    return location ? `:${location.startLine}:${location.startCol}` : "";
}

function throwJenerateError(
    ref: IDocumentReference,
    location: NodeLocation | undefined,
    error: unknown,
): never {
    if (error instanceof JenerateError) {
        throw error;
    }

    const origin = `${getRootRelativePath(ref)}${getLocationString(location)}`;

    if (isNodeError(error)) {
        switch (error.code) {
            case "ENOENT": {
                assert(typeof error.path === "string");

                throw new JenerateError(
                    `${origin} - Not found: ${getRelativeUrl(
                        ref.url,
                        pathToFileURL(error.path),
                    )}`,
                    {
                        cause: error,
                    },
                );
            }

            case "EPERM": {
                assert(typeof error.path === "string");

                throw new JenerateError(
                    `${origin} - Access denied: ${getRelativeUrl(
                        ref.url,
                        pathToFileURL(error.path),
                    )}`,
                    { cause: error },
                );
            }

            default: {
                break;
            }
        }
    }

    const message = Error.isError(error) ? error.message : String(error);

    throw new JenerateError(
        `${getRootRelativePath(ref)}${location} - ${message}`,
        { cause: error },
    );
}

export function getRelativeUrl(
    from: URL | undefined,
    to: URL,
): string | undefined {
    if (!from) {
        return to.protocol === "file:" ? fileURLToPath(to) : to.toString();
    }

    if (getAuthority(from) === getAuthority(to)) {
        return (
            relativePosixPath(posixDirname(from.pathname), to.pathname) +
            to.search
        );
    }
}

function getRootRelativePath(ref: IDocumentReference): string {
    const result = getRelativeUrl(getRootReferrer(ref)?.url, ref.url);

    return result ?? ref.toString();
}

function getAuthority(url: URL): string {
    const { origin, username, password } = url;

    if (username !== "") {
        if (password !== "") {
            return `${origin}@${username}:${password}`;
        } else {
            return `${origin}@${username}`;
        }
    } else {
        if (password !== "") {
            return `${origin}@:${password}`;
        } else {
            return `${origin}`;
        }
    }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return (
        Error.isError(error) &&
        ("errno" in error ||
            "code" in error ||
            "path" in error ||
            "syscall" in error)
    );
}
