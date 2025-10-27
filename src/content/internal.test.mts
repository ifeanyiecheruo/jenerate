import { platform } from "node:os";
import {
    afterEach,
    beforeEach,
    describe,
    it,
    type TestContext,
} from "node:test";
import { fs as memFs, vol } from "memfs";
import {
    // support for mocking fetch
    // see https://nodejs.org/en/learn/test-runner/mocking#apis
    getGlobalDispatcher,
    MockAgent,
    setGlobalDispatcher,
} from "undici";

import { createDocumentReference } from "../../dist/content/DocumentReference.mjs";
import { fetchReference } from "../../dist/content/internal.mjs";

describe("fetch", () => {
    let fetchMock: MockAgent;
    const globalDispatcher = getGlobalDispatcher();

    beforeEach(() => {
        fetchMock = new MockAgent();
        fetchMock.disableNetConnect();

        setGlobalDispatcher(fetchMock);
    });

    afterEach(() => {
        setGlobalDispatcher(globalDispatcher);
        fetchMock.close();
    });

    it("can fetch remote content", async (test: TestContext) => {
        fetchMock
            .get("https://www.example.com")
            .intercept({
                path: "/file.txt",
                method: "GET",
            })
            .reply(200, "Remote Mocked content")
            .times(2);

        const ref = createDocumentReference(
            new URL(`https://www.example.com/file.txt`),
        );

        const textContent = await fetchReference(ref);
        test.assert.deepStrictEqual(textContent, "Remote Mocked content");

        const bufferContent = await fetchReference(ref, { asBinary: true });
        test.assert.deepStrictEqual(
            bufferContent,
            new TextEncoder().encode("Remote Mocked content").buffer,
        );
    });

    it("can fail remote content", async (test: TestContext) => {
        fetchMock
            .get("https://www.example.com")
            .intercept({
                path: "/file.txt",
                method: "GET",
            })
            .reply(404, "");

        const ref = createDocumentReference(
            new URL(`https://www.example.com/file.txt`),
        );

        test.assert.rejects(
            () => fetchReference(ref),
            new Error("https://www.example.com/file.txt 404: Not Found"),
        );
    });

    it("can fetch local content", async (test: TestContext) => {
        const fsRoot = platform() === "win32" ? "c:\\" : "/";

        vol.reset();
        vol.fromJSON({
            [`${fsRoot}mock/file.txt`]: "Mocked content",
        });

        const ref = createDocumentReference(
            new URL(`file://${fsRoot}mock/file.txt`),
        );

        const content = await fetchReference(ref, { fs: memFs });

        test.assert.deepStrictEqual(content, "Mocked content");
    });
});
