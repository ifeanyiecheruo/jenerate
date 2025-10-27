import {
    dirname as posixDirname,
    relative as relativePosixPath,
} from "node:path/posix";

export enum UrlParts {
    Scheme = 1 << 1,
    Username = 1 << 2,
    Password = 1 << 3,
    HostName = 1 << 4,
    Port = 1 << 5,
    Path = 1 << 7,
    Search = 1 << 8,
    Fragment = 1 << 9,
    UserInfo = Username | Password,
    Host = HostName | Port,
    Origin = Scheme | Host,
    Authority = Origin | UserInfo,
}

export function getRelativeUrl(from: URL, to: URL): string {
    if (
        getUrlParts(from, UrlParts.Authority) ===
        getUrlParts(to, UrlParts.Authority)
    ) {
        const fromPath = from.pathname.endsWith("/")
            ? from.pathname
            : posixDirname(from.pathname);

        return relativePosixPath(fromPath, to.pathname) + to.search;
    }

    return to.href;
}

export function getUrlParts(url: URL, parts: UrlParts): string {
    const result: string[] = [];

    if (parts & UrlParts.Scheme) {
        result.push(url.protocol);
    }

    if (parts & UrlParts.Username) {
        if (parts & UrlParts.Scheme) {
            result.push("//");
        }

        result.push(url.username);
    }

    if (parts & UrlParts.Password) {
        if (parts & UrlParts.Username) {
            result.push(":");
        } else if (parts & UrlParts.Scheme) {
            result.push("//:");
        }

        result.push(url.password);
    }

    if (parts & UrlParts.HostName) {
        if (parts & (UrlParts.Username | UrlParts.Password)) {
            result.push("@");
        } else if (parts & UrlParts.Scheme) {
            result.push("//");
        }

        result.push(url.hostname);
    }

    if (parts & UrlParts.Port) {
        if (url.port) {
            if (
                parts &
                (UrlParts.HostName | UrlParts.Username | UrlParts.Password)
            ) {
                result.push(":");
            } else if (parts & UrlParts.Scheme) {
                result.push("//:");
            }

            result.push(url.port);
        }
    }

    if (parts & UrlParts.Path) {
        result.push(url.pathname);
    }

    if (parts & UrlParts.Search) {
        result.push(url.search);
    }

    if (parts & UrlParts.Fragment) {
        result.push(url.hash);
    }

    return result.join("");
}
