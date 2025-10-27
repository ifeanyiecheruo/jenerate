import assert from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import ejs from "ejs";
import { JSDOM } from "jsdom";
import pretty from "pretty";
import {
    createDocumentReference,
    fetchCSVContent,
    fetchHTMLContent,
    getRelativeUrl,
    type ICSVContent,
    type IDocumentReference,
    type IHTMLContent,
    type ISourceLocation,
    SourceLocation,
    walk,
} from "../content/index.mjs";
import { getLocation, type NodeLocation } from "../dom.mjs";
import { JenerateError } from "./JenerateError.mjs";

const DOCUMENT_POSITION_FOLLOWING = 4;
const DOCUMENT_POSITION_PRECEDING = 2;
const SNIPPET_TAG_NAME = "x-jen-snippet";
const FROM_DATA_TAG_NAME = "x-jen-from-data";

/* node:coverage disable */

interface IJenerateHTMLContext {
    followRemoteReferences?: boolean | undefined;
    dependencies: Set<IJenerateHTMLReference>;
    env: Record<string, unknown>;
    visited: Set<string>;
}

type WorkItemCallback = (
    dom: JSDOM,
    target: Element,
    ref: IDocumentReference,
    context: IJenerateHTMLContext,
) => Promise<void>;

export interface IJenerateHTMLOptions {
    inputFilePath: string;
    outputFilePath: string;
    inputRootPath: string;
    signal?: AbortSignal | undefined;
    followRemoteReferences?: boolean;
}

export interface IJenerateHTMLReference {
    ref: URL;
    referrer: ISourceLocation | undefined;
}

export interface IJenerateHTMLResult {
    dependencies: Iterable<IJenerateHTMLReference>;
    assets: Iterable<IJenerateHTMLReference>;
}

/* node:coverage enable */

export async function jenerateHTML(
    options: IJenerateHTMLOptions,
): Promise<IJenerateHTMLResult> {
    const inputUrl = pathToFileURL(options.inputFilePath);

    const contentIterator = walk(inputUrl, "text/html", {
        rootUrl: pathToFileURL(options.inputRootPath),
        followRemoteReferences: false,
        ignoreNotFound: true,
    });

    const dependecies: Set<IJenerateHTMLReference> = new Set();
    const assets: Set<IJenerateHTMLReference> = new Set();

    for await (const entry of contentIterator) {
        if (options.signal?.aborted) {
            break;
        }

        const { content } = entry;

        switch (content.type) {
            case "html": {
                if (content.ref.url.href === inputUrl.href) {
                    // We have walked to the document we were asked to jenerate
                    // expand any jen-* directives and write the file to disk
                    await expandDocumentFromContent(
                        content.ref,
                        content.dom,
                        undefined,
                        {
                            followRemoteReferences:
                                options.followRemoteReferences,
                            dependencies: dependecies,
                            env: {},
                            visited: new Set(),
                        },
                    );

                    const domString = pretty(content.dom.serialize(), {
                        ocd: true,
                    });

                    await mkdir(dirname(options.outputFilePath), {
                        recursive: true,
                    });
                    await writeFile(options.outputFilePath, domString, {
                        encoding: "utf-8",
                    });
                }

                break;
            }

            default: {
                assets.add({
                    ref: content.ref.url,
                    referrer: entry.sourceLocation,
                });
                break;
            }
        }
    }

    return { dependencies: dependecies, assets: assets };
}

async function expandDocumentFromContent(
    ref: IDocumentReference,
    dom: JSDOM,
    sourceLocation: ISourceLocation | undefined,
    context: IJenerateHTMLContext,
): Promise<void> {
    if (context.visited.has(ref.url.href)) {
        // Prune loops
        return;
    }

    context.visited.add(ref.url.href);

    try {
        const {
            window: { document, customElements, HTMLElement },
        } = dom;

        class CustomVoidHTMLElement extends HTMLElement {
            connectedCallback() {
                for (
                    let child = this.lastChild;
                    child;
                    child = this.lastChild
                ) {
                    this.after(child);
                }
            }
        }

        customElements.define(SNIPPET_TAG_NAME, CustomVoidHTMLElement);

        const workItems: Array<{
            target: Element;
            callback: WorkItemCallback;
        }> = [];

        // Find a all the jen-* directives and queue them up for processing
        for (const element of document.getElementsByTagName(
            FROM_DATA_TAG_NAME,
        )) {
            workItems.push({ target: element, callback: processForEach });
        }

        for (const element of document.head.getElementsByTagName("link")) {
            if (element.getAttribute("rel") === SNIPPET_TAG_NAME) {
                workItems.push({
                    target: element,
                    callback: processRelSnippet,
                });
            }
        }

        for (const element of document.body.getElementsByTagName(
            SNIPPET_TAG_NAME,
        )) {
            workItems.push({ target: element, callback: processSnippet });
        }

        // Since the queued work items mutate DOM nodes it is important we do the mutation
        // from the bottom of the document to the top of the document to minimize the
        // potential for an early mutation to have a side-effect on later content.
        workItems.sort((a, b) => -compareDOMNodes(a.target, b.target));

        for (const { target, callback } of workItems) {
            await callback(dom, target, ref, context);
        }

        context.dependencies.add({
            ref: ref.url,
            referrer: sourceLocation,
        });

        return;
    } finally {
        context.visited.delete(ref.url.href);
    }
}

async function processSnippet(
    dom: JSDOM,
    target: Element,
    ref: IDocumentReference,
    context: IJenerateHTMLContext,
): Promise<void> {
    return await processSnippetImpl(dom, target, "src", ref, context);
}

async function processRelSnippet(
    dom: JSDOM,
    target: Element,
    ref: IDocumentReference,
    context: IJenerateHTMLContext,
): Promise<void> {
    return await processSnippetImpl(dom, target, "href", ref, context);
}

async function processForEach(
    dom: JSDOM,
    target: Element,
    ref: IDocumentReference,
    context: IJenerateHTMLContext,
): Promise<void> {
    const src = target.getAttribute("src");

    if (typeof src === "string") {
        const srcLocation = new SourceLocation(ref, getLocation(dom, target));

        let csvContent: ICSVContent | undefined;

        try {
            // Do not use ref.resolve(src) because we do not want to honor IDocumentReference roots
            const srcRef = new URL(src, ref.url);

            if (canFetchReference(srcRef, context)) {
                csvContent = await fetchCSVContent(
                    createDocumentReference(srcRef),
                );
            }
        } catch (error) {
            throwJenerateError(srcLocation, error);
        }

        if (typeof csvContent !== "undefined") {
            const selectAttr = target.getAttributeNode("select");

            if (!selectAttr) {
                throw new JenerateError(
                    [
                        `${srcLocation} - No columns selected.`,
                        `You must use a 'select' attribute to say which columns from ${src} you want to use in your template`,
                        `Available columns in ${src} are`,
                        ...csvContent.headers.map((item) => `\t- ${item}`),
                    ].join("\n"),
                );
            }

            const selectLocation = new SourceLocation(
                ref,
                getLocation(dom, selectAttr),
            );

            const select = selectAttr?.nodeValue?.trim();
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
                        `${selectLocation} - Selected column not found.`,
                        `The following selected columns were not found in ${src}`,
                        ...unknownSelection.map((item) => `\t- ${item}`),
                        `Available columns in ${src} are`,
                        ...csvContent.headers.map((item) => `\t- ${item}`),
                    ].join("\n"),
                );
            }

            const unselectedParams = Object.entries(
                getEJSTemplateParameters(dom, target),
            )
                .filter(([column]) => !selectedColumns.includes(column))
                .map(
                    ([column, columnLocation]) =>
                        `\t${column} - ${new SourceLocation(ref, columnLocation)}`,
                );

            if (unselectedParams.length > 0) {
                throw new JenerateError(
                    [
                        `${selectLocation} - The following name(s) are used in a template without first being selected`,
                        ...unselectedParams,
                        `Fix the spelling of the name(s) in the template or add the problematic name(s) to the 'select' attribute`,
                    ].join("\n"),
                );
            }

            for (const row of csvContent.rows) {
                const rowEnv = { ...context.env, ...row };
                const rowDom = new JSDOM(
                    ejs.render(
                        target.innerHTML.replaceAll(
                            /&lt;%=\s*(.*?)\s*%&gt;/g,
                            "<%= $1 %>",
                        ),
                        rowEnv,
                    ),
                    {
                        url: ref.url.href,
                        contentType: "text/html",
                        referrer: ref.referrer?.url.href,
                        storageQuota: 0,
                        includeNodeLocations: true,
                        runScripts: undefined,
                    },
                );

                await expandDocumentFromContent(ref, rowDom, srcLocation, {
                    ...context,
                    env: rowEnv,
                });

                outerHtml += rowDom.serialize();
            }

            context.dependencies.add({
                ref: csvContent.ref.url,
                referrer: srcLocation,
            });

            target.insertAdjacentHTML("afterend", outerHtml);
        }
    }

    target.remove();
}

async function processSnippetImpl(
    dom: JSDOM,
    target: Element,
    srcAttr: string,
    ref: IDocumentReference,
    context: IJenerateHTMLContext,
): Promise<void> {
    const srcNode = target.getAttributeNode(srcAttr);
    const src = srcNode?.value;

    if (typeof src === "string") {
        // Do not use ref.resolve(src) because we do not want to honor IDocumentReference roots
        const srcRef = new URL(src, ref.url);
        const srcLocation = new SourceLocation(ref, getLocation(dom, srcNode));

        let content: IHTMLContent | undefined;
        try {
            if (canFetchReference(srcRef, context)) {
                content = await fetchHTMLContent(
                    createDocumentReference(srcRef),
                );
            }
        } catch (error) {
            throwJenerateError(srcLocation, error);
        }

        if (typeof content !== "undefined") {
            await expandDocumentFromContent(
                content.ref,
                content.dom,
                srcLocation,
                context,
            );

            target.insertAdjacentHTML("afterend", content.dom.serialize());
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

    const {
        window: { document, NodeFilter },
    } = dom;
    const treeWalker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
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

            /* node:coverage disable */
            default: {
                assert.fail();
            }
            /* node:coverage enable */
        }
    }
}

function throwJenerateError(
    sourceLocation: ISourceLocation,
    error: unknown,
): never {
    if (error instanceof JenerateError) {
        throw error;
    }

    if (isNodeError(error)) {
        switch (error.code) {
            case "ENOENT": {
                assert(typeof error.path === "string");

                const errorUrl = getRelativeUrl(
                    sourceLocation.ref.url,
                    pathToFileURL(error.path),
                );

                throw new JenerateError(
                    `${sourceLocation} - Not found: ${errorUrl}`,
                    {
                        cause: error,
                    },
                );
            }

            case "EPERM": {
                assert(typeof error.path === "string");

                throw new JenerateError(
                    `${sourceLocation} - Access denied: ${getRelativeUrl(
                        sourceLocation.ref.url,
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

    throw new JenerateError(`${sourceLocation} - ${message}`, { cause: error });
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

function canFetchReference(url: URL, context: IJenerateHTMLContext): boolean {
    return url.protocol === "file:" || !!context.followRemoteReferences;
}
