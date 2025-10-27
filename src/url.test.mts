import { describe, it, type TestContext } from "node:test";
import { getRelativeUrl, getUrlParts, UrlParts } from "../dist/url.mjs";

describe("getRelativeUrl", () => {
    function verify(test: TestContext, a: URL, b: URL): void {
        const rel = getRelativeUrl(a, b);

        test.assert.equal(new URL(rel, a).href, b.href);
    }

    it("gets relative path if same authority", (test: TestContext) => {
        verify(
            test,
            new URL("https://www.example.com"),
            new URL("https://www.example.com"),
        );

        verify(
            test,
            new URL("https://www.example.com/"),
            new URL("https://www.example.com/"),
        );

        verify(
            test,
            new URL("https://www.example.com/foo.html"),
            new URL("https://www.example.com/foo.html"),
        );

        verify(
            test,
            new URL("https://www.example.com/foo.html"),
            new URL("https://www.example.com/bar.html"),
        );

        verify(
            test,
            new URL("https://www.example.com/baz/foo.html"),
            new URL("https://www.example.com/baz/bar.html"),
        );

        verify(
            test,
            new URL("https://www.example.com/boo/foo.html"),
            new URL("https://www.example.com/baz/bar.html"),
        );

        verify(
            test,
            new URL("https://www.example.com/foo.html"),
            new URL("https://www.example.com/baz/bar.html"),
        );

        verify(
            test,
            new URL("https://www.example.com/baz/foo.html"),
            new URL("https://www.example.com/bar.html"),
        );
    });

    it("preserves destination query", (test: TestContext) => {
        verify(
            test,
            new URL("https://www.example.com"),
            new URL("https://www.example.com"),
        );

        verify(
            test,
            new URL("https://www.example.com/"),
            new URL("https://www.example.com/"),
        );

        verify(
            test,
            new URL("https://www.example.com/foo.html"),
            new URL("https://www.example.com/foo.html"),
        );

        verify(
            test,
            new URL("https://www.example.com/foo.html"),
            new URL("https://www.example.com/bar.html"),
        );

        verify(
            test,
            new URL("https://www.example.com/baz/foo.html"),
            new URL("https://www.example.com/baz/bar.html"),
        );

        verify(
            test,
            new URL("https://www.example.com/boo/foo.html"),
            new URL("https://www.example.com/baz/bar.html"),
        );

        verify(
            test,
            new URL("https://www.example.com/foo.html"),
            new URL("https://www.example.com/baz/bar.html"),
        );

        verify(
            test,
            new URL("https://www.example.com/baz/foo.html"),
            new URL("https://www.example.com/bar.html"),
        );
    });

    it("gets destination url different authority", (test: TestContext) => {
        verify(
            test,
            new URL("https://www.example.com/"),
            new URL("http://www.example.com/"),
        );

        verify(
            test,
            new URL("https://www.foo.com"),
            new URL("https://www.bar.com"),
        );

        verify(
            test,
            new URL("https://www.example.com"),
            new URL("https://user:password@www.example.com"),
        );

        verify(
            test,
            new URL("https://www.example.com"),
            new URL("https://:password@www.example.com"),
        );

        verify(
            test,
            new URL("https://www.example.com"),
            new URL("https://user:@www.example.com"),
        );

        verify(
            test,
            new URL("https://www.example.com"),
            new URL("https://:@www.example.com"),
        );

        verify(
            test,
            new URL("https://www.example.com/"),
            new URL("https://www.example.com:1023/"),
        );
    });
});

describe("getUrlParts", () => {
    it("gets scheme", (test: TestContext) => {
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path?search#fragment",
                UrlParts.Scheme,
            ),
            "https:",
        );
    });

    it("gets username", (test: TestContext) => {
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path?search#fragment",
                UrlParts.Username,
            ),
            "user",
        );
        test.assert.equal(
            getParts(
                "https://:password@www.example.com:443/path?search#fragment",
                UrlParts.Username,
            ),
            "",
        );
        test.assert.equal(
            getParts(
                "https://user:@www.example.com:443/path?search#fragment",
                UrlParts.Username,
            ),
            "user",
        );
        test.assert.equal(
            getParts(
                "https://user@www.example.com:443/path?search#fragment",
                UrlParts.Username,
            ),
            "user",
        );
        test.assert.equal(
            getParts(
                "https://:@www.example.com:443/path?search#fragment",
                UrlParts.Username,
            ),
            "",
        );

        test.assert.equal(
            getParts(
                "https://www.example.com:443/path?search#fragment",
                UrlParts.Username,
            ),
            "",
        );
    });

    it("gets password", (test: TestContext) => {
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path?search#fragment",
                UrlParts.Password,
            ),
            "password",
        );
        test.assert.equal(
            getParts(
                "https://:password@www.example.com:443/path?search#fragment",
                UrlParts.Password,
            ),
            "password",
        );
        test.assert.equal(
            getParts(
                "https://user:@www.example.com:443/path?search#fragment",
                UrlParts.Password,
            ),
            "",
        );
        test.assert.equal(
            getParts(
                "https://user@www.example.com:443/path?search#fragment",
                UrlParts.Password,
            ),
            "",
        );
        test.assert.equal(
            getParts(
                "https://:@www.example.com:443/path?search#fragment",
                UrlParts.Password,
            ),
            "",
        );

        test.assert.equal(
            getParts(
                "https://www.example.com:443/path?search#fragment",
                UrlParts.Password,
            ),
            "",
        );
    });

    it("gets hostname", (test: TestContext) => {
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path?search#fragment",
                UrlParts.HostName,
            ),
            "www.example.com",
        );
    });

    it("gets port", (test: TestContext) => {
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:1023/path?search#fragment",
                UrlParts.Port,
            ),
            "1023",
        );

        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path?search#fragment",
                UrlParts.Port,
            ),
            "",
        );
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:1023?search#fragment",
                UrlParts.Port,
            ),
            "1023",
        );
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:1023",
                UrlParts.Port,
            ),
            "1023",
        );

        test.assert.equal(
            getParts(
                "https://user:password@www.example.com/path?search#fragment",
                UrlParts.Port,
            ),
            "",
        );
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com?search#fragment",
                UrlParts.Port,
            ),
            "",
        );
        test.assert.equal(
            getParts("https://user:password@www.example.com", UrlParts.Port),
            "",
        );
    });

    it("gets path", (test: TestContext) => {
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path?search#fragment",
                UrlParts.Path,
            ),
            "/path",
        );
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path#fragment",
                UrlParts.Path,
            ),
            "/path",
        );

        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/?search#fragment",
                UrlParts.Path,
            ),
            "/",
        );
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/#fragment",
                UrlParts.Path,
            ),
            "/",
        );

        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443?search#fragment",
                UrlParts.Path,
            ),
            "/",
        );
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com?search#fragment",
                UrlParts.Path,
            ),
            "/",
        );

        test.assert.equal(
            getParts("https://user:password@www.example.com", UrlParts.Path),
            "/",
        );
    });

    it("gets search", (test: TestContext) => {
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path?search#fragment",
                UrlParts.Search,
            ),
            "?search",
        );
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443?search#fragment",
                UrlParts.Search,
            ),
            "?search",
        );
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com?search#fragment",
                UrlParts.Search,
            ),
            "?search",
        );

        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path?#fragment",
                UrlParts.Search,
            ),
            "",
        );
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443?#fragment",
                UrlParts.Search,
            ),
            "",
        );
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com?#fragment",
                UrlParts.Search,
            ),
            "",
        );

        test.assert.equal(
            getParts("https://user:password@www.example.com", UrlParts.Search),
            "",
        );
    });

    it("gets fragment", (test: TestContext) => {
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path?search#fragment",
                UrlParts.Fragment,
            ),
            "#fragment",
        );
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path?#fragment",
                UrlParts.Fragment,
            ),
            "#fragment",
        );
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path#fragment",
                UrlParts.Fragment,
            ),
            "#fragment",
        );

        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/#fragment",
                UrlParts.Fragment,
            ),
            "#fragment",
        );
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443#fragment",
                UrlParts.Fragment,
            ),
            "#fragment",
        );
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com#fragment",
                UrlParts.Fragment,
            ),
            "#fragment",
        );

        test.assert.equal(
            getParts("https://user:password@www.example.com", UrlParts.Search),
            "",
        );
    });

    it("gets user info", (test: TestContext) => {
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path?search",
                UrlParts.UserInfo,
            ),
            "user:password",
        );
        test.assert.equal(
            getParts(
                "https://:password@www.example.com:443/path?search",
                UrlParts.UserInfo,
            ),
            ":password",
        );
        test.assert.equal(
            getParts(
                "https://user:@www.example.com:443/path?search",
                UrlParts.UserInfo,
            ),
            "user:",
        );
        test.assert.equal(
            getParts(
                "https://user@www.example.com:443/path?search",
                UrlParts.UserInfo,
            ),
            "user:",
        );
        test.assert.equal(
            getParts(
                "https://:@www.example.com:443/path?search",
                UrlParts.UserInfo,
            ),
            ":",
        );

        test.assert.equal(
            getParts(
                "https://www.example.com:443/path?search",
                UrlParts.UserInfo,
            ),
            ":",
        );
    });

    it("gets host", (test: TestContext) => {
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path?search",
                UrlParts.Host,
            ),
            "www.example.com",
        );

        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:1023/path?search",
                UrlParts.Host,
            ),
            "www.example.com:1023",
        );
    });

    it("gets origin", (test: TestContext) => {
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path?search",
                UrlParts.Origin,
            ),
            "https://www.example.com",
        );

        test.assert.equal(
            getParts(
                "https://www.example.com:1023/path?search",
                UrlParts.Origin,
            ),
            "https://www.example.com:1023",
        );
    });

    it("gets authority", (test: TestContext) => {
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path?search",
                UrlParts.Authority,
            ),
            "https://user:password@www.example.com",
        );

        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:1023/path?search",
                UrlParts.Authority,
            ),
            "https://user:password@www.example.com:1023",
        );
    });

    it("gets non-adjacent parts", (test: TestContext) => {
        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:443/path?search",
                UrlParts.Scheme | UrlParts.Password,
            ),
            "https://:password",
        );

        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:1023/path?search",
                UrlParts.Scheme | UrlParts.HostName,
            ),
            "https://www.example.com",
        );

        test.assert.equal(
            getParts(
                "https://user:password@www.example.com:1023/path?search",
                UrlParts.Scheme | UrlParts.Port,
            ),
            "https://:1023",
        );
    });
});

function getParts(url: string, part: UrlParts): string {
    return getUrlParts(new URL(url), part);
}
