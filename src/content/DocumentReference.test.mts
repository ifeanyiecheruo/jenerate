import { describe, it, type TestContext } from "node:test";
import { inspect } from "node:util";

import {
    createDocumentReference,
    getRootReferrer,
    type IDocumentReference,
} from "../../dist/content/DocumentReference.mjs";

it("can create simple ref", async (test: TestContext) => {
    const ref = createDocumentReference(
        new URL(
            "https://user:password@www.example.com:1023/path?search#fragment",
        ),
    );

    test.assert.deepStrictEqual(ref.referrer, undefined);
    test.assert.deepStrictEqual(
        ref.url.href,
        "https://user:password@www.example.com:1023/path?search#fragment",
    );
});

it("supports inspect.custom", async (test: TestContext) => {
    interface IUtilInspectable {
        [inspect.custom](_depth: number, _options: unknown): string;
    }
    const ref = createDocumentReference(
        new URL(
            "https://user:password@www.example.com:1023/path?search#fragment",
        ),
    );

    const asUtilInspectable = ref as unknown as IUtilInspectable;

    test.assert.deepStrictEqual(
        asUtilInspectable[inspect.custom](0, undefined),
        "https://user:password@www.example.com:1023/path?search#fragment",
    );
});

it("can track referrers", async (test: TestContext) => {
    const urls: [URL, string][] = [
        [new URL("https://www.example.com"), "./page-0.html"],
        [new URL("https://www.example.com/page-0.html"), "./page-1.html"],
        [
            new URL("https://www.example.com/page-1.html"),
            "./images/tiles/1x1.png",
        ],
        [
            new URL("https://www.example.com/images/tiles/1x1.png"),
            "../icon.png",
        ],
        [new URL("https://www.example.com/images/icon.png"), "/"],
        [new URL("https://www.example.com/"), ""],
    ];

    let ref: IDocumentReference | undefined;
    let expectedReferrer: IDocumentReference | undefined;
    for (const [url, rel] of urls) {
        if (!ref) {
            ref = createDocumentReference(url);
        } else {
            test.assert.deepStrictEqual(ref.url.href, url.href);
            test.assert.deepStrictEqual(ref.referrer, expectedReferrer);
        }

        expectedReferrer = ref;
        ref = ref.resolve(rel);
    }
});

it("can get root referrer", async (test: TestContext) => {
    const urls: [URL, string][] = [
        [new URL("https://www.example.com"), "./page-0.html"],
        [new URL("https://www.example.com/page-0.html"), "./page-1.html"],
        [
            new URL("https://www.example.com/page-1.html"),
            "./images/tiles/1x1.png",
        ],
        [
            new URL("https://www.example.com/images/tiles/1x1.png"),
            "../icon.png",
        ],
        [new URL("https://www.example.com/images/icon.png"), "/"],
        [new URL("https://www.example.com/"), ""],
    ];

    let ref: IDocumentReference | undefined;
    let rootRef: IDocumentReference | undefined;

    for (const [url, rel] of urls) {
        if (!ref) {
            ref = createDocumentReference(url);
            test.assert.deepStrictEqual(getRootReferrer(ref), undefined);

            rootRef = ref;
        }

        ref = ref.resolve(rel);

        test.assert.deepStrictEqual(getRootReferrer(ref), rootRef);
    }
});

describe("resolve", async () => {
    it("can resolve absolute url", async (test: TestContext) => {
        const ref = createDocumentReference(
            new URL(
                "https://user:password@www.example.com:1023/path/index.html?search#fragment",
            ),
        );

        const resolved = ref.resolve("https://localhost");

        test.assert.deepStrictEqual(resolved.referrer, ref);
        test.assert.deepStrictEqual(resolved.url.href, "https://localhost/");
    });

    it("can resolve relative url", async (test: TestContext) => {
        const ref = createDocumentReference(
            new URL(
                "https://user:password@www.example.com:1023/path/index.html?search#fragment",
            ),
        );

        const resolved = ref.resolve("relative.html");

        test.assert.deepStrictEqual(resolved.referrer, ref);
        test.assert.deepStrictEqual(
            resolved.url.href,
            "https://user:password@www.example.com:1023/path/relative.html",
        );
    });

    it("can resolve relative url with search and fragment", async (test: TestContext) => {
        const ref = createDocumentReference(
            new URL(
                "https://user:password@www.example.com:1023/path/index.html?search#fragment",
            ),
        );

        const resolved = ref.resolve("relative.html?othersearch#otherfragment");

        test.assert.deepStrictEqual(resolved.referrer, ref);
        test.assert.deepStrictEqual(
            resolved.url.href,
            "https://user:password@www.example.com:1023/path/relative.html?othersearch#otherfragment",
        );
    });

    it("can resolve relative url with relative path", async (test: TestContext) => {
        const ref = createDocumentReference(
            new URL(
                "https://user:password@www.example.com:1023/foo/bar/index.html?search#fragment",
            ),
        );

        const resolved = ref.resolve(
            "../bar/.././relative.html?othersearch#otherfragment",
        );

        test.assert.deepStrictEqual(resolved.referrer, ref);
        test.assert.deepStrictEqual(
            resolved.url.href,
            "https://user:password@www.example.com:1023/foo/relative.html?othersearch#otherfragment",
        );
    });

    it("can resolve relative url with escaping relative path as root relative path", async (test: TestContext) => {
        const ref = createDocumentReference(
            new URL(
                "https://user:password@www.example.com:1023/foo/bar/index.html?search#fragment",
            ),
        );

        const resolved = ref.resolve(
            "../../../../../../relative.html?othersearch#otherfragment",
        );

        test.assert.deepStrictEqual(resolved.referrer, ref);
        test.assert.deepStrictEqual(
            resolved.url.href,
            "https://user:password@www.example.com:1023/relative.html?othersearch#otherfragment",
        );
    });

    it("can resolve root relative url", async (test: TestContext) => {
        const ref = createDocumentReference(
            new URL(
                "https://user:password@www.example.com:1023/path/index.html?search#fragment",
            ),
        );

        const resolved = ref.resolve("/relative.html");

        test.assert.deepStrictEqual(resolved.referrer, ref);
        test.assert.deepStrictEqual(
            resolved.url.href,
            "https://user:password@www.example.com:1023/relative.html",
        );
    });

    it("can resolve root relative url with search and fragment", async (test: TestContext) => {
        const ref = createDocumentReference(
            new URL(
                "https://user:password@www.example.com:1023/path/index.html?search#fragment",
            ),
        );

        const resolved = ref.resolve(
            "/relative.html?othersearch#otherfragment",
        );

        test.assert.deepStrictEqual(resolved.referrer, ref);
        test.assert.deepStrictEqual(
            resolved.url.href,
            "https://user:password@www.example.com:1023/relative.html?othersearch#otherfragment",
        );
    });

    describe("rooted", () => {
        it("can resolve relative url", async (test: TestContext) => {
            const ref = createDocumentReference(
                new URL(
                    "file:///home/user/projects/jenerate/path/index.html?search#fragment",
                ),
                new URL("file:///home/user/projects/jenerate/"),
            );

            const resolved = ref.resolve("relative.html");

            test.assert.deepStrictEqual(resolved.referrer, ref);
            test.assert.deepStrictEqual(
                resolved.url.href,
                "file:///home/user/projects/jenerate/path/relative.html",
            );
        });

        it("can resolve relative url with search and fragment", async (test: TestContext) => {
            const ref = createDocumentReference(
                new URL(
                    "file:///home/user/projects/jenerate/path/index.html?search#fragment",
                ),
                new URL("file:///home/user/projects/jenerate/"),
            );

            const resolved = ref.resolve(
                "relative.html?othersearch#otherfragment",
            );

            test.assert.deepStrictEqual(resolved.referrer, ref);
            test.assert.deepStrictEqual(
                resolved.url.href,
                "file:///home/user/projects/jenerate/path/relative.html?othersearch#otherfragment",
            );
        });

        it("can resolve relative url with relative path", async (test: TestContext) => {
            const ref = createDocumentReference(
                new URL(
                    "file:///home/user/projects/jenerate/foo/bar/index.html?search#fragment",
                ),
                new URL("file:///home/user/projects/jenerate/"),
            );

            const resolved = ref.resolve(
                "../bar/.././relative.html?othersearch#otherfragment",
            );

            test.assert.deepStrictEqual(resolved.referrer, ref);
            test.assert.deepStrictEqual(
                resolved.url.href,
                "file:///home/user/projects/jenerate/foo/relative.html?othersearch#otherfragment",
            );
        });

        it("can resolve relative url with escaping relative path as root relative path", async (test: TestContext) => {
            const ref = createDocumentReference(
                new URL(
                    "file:///home/user/projects/jenerate/foo/bar/index.html?search#fragment",
                ),
                new URL("file:///home/user/projects/jenerate/"),
            );

            const resolved = ref.resolve(
                "../../../../../../relative.html?othersearch#otherfragment",
            );

            test.assert.deepStrictEqual(resolved.referrer, ref);
            test.assert.deepStrictEqual(
                resolved.url.href,
                "file:///home/user/projects/jenerate/relative.html?othersearch#otherfragment",
            );
        });

        it("can resolve root relative url", async (test: TestContext) => {
            const ref = createDocumentReference(
                new URL(
                    "file:///home/user/projects/jenerate/path/index.html?search#fragment",
                ),
                new URL("file:///home/user/projects/jenerate/"),
            );

            const resolved = ref.resolve("/relative.html");

            test.assert.deepStrictEqual(resolved.referrer, ref);
            test.assert.deepStrictEqual(
                resolved.url.href,
                "file:///home/user/projects/jenerate/relative.html",
            );
        });

        it("can resolve root relative url with search and fragment", async (test: TestContext) => {
            const ref = createDocumentReference(
                new URL(
                    "file:///home/user/projects/jenerate/path/index.html?search#fragment",
                ),
                new URL("file:///home/user/projects/jenerate/"),
            );

            const resolved = ref.resolve(
                "/relative.html?othersearch#otherfragment",
            );

            test.assert.deepStrictEqual(resolved.referrer, ref);
            test.assert.deepStrictEqual(
                resolved.url.href,
                "file:///home/user/projects/jenerate/relative.html?othersearch#otherfragment",
            );
        });
    });
});
