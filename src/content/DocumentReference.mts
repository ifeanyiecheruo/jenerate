import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";

export interface IDocumentReference {
  readonly url: URL;
  readonly referrer: IDocumentReference | undefined;

  fetch(): Promise<string | undefined>;
  fetch(asBinary: false): Promise<string | undefined>;
  fetch(asBinary: true): Promise<ArrayBuffer | undefined>;
  fetch(asBinary?: boolean): Promise<string | ArrayBuffer | undefined>;

  resolve(url: URL): IDocumentReference;
  resolve(path: string): IDocumentReference;
  resolve(urlOrPath: URL | string): IDocumentReference;
}

export interface ITypedDocumentReference {
  type: string;
  ref: IDocumentReference;
}

interface IResolveContext {
  baseURL: URL;
  allowRemoteFetch?: boolean | undefined;
}

export interface IDocumentReferenceOptions {
  baseURL: URL;
}

export function createDocumentReference(
  url: URL,
  options: IDocumentReferenceOptions
): IDocumentReference {
  return new DocumentReference(url, undefined, {
    baseURL: options.baseURL,
  });
}

export function getRootReferrer(
  ref: IDocumentReference
): IDocumentReference | undefined {
  let result = ref.referrer;
  while (result?.referrer) {
    result = result.referrer;
  }

  return result;
}

class DocumentReference implements IDocumentReference {
  private _context: IResolveContext;
  private _url: URL;
  private _referrer: IDocumentReference | undefined;

  public constructor(
    url: URL,
    referrer: IDocumentReference | undefined,
    context: IResolveContext
  ) {
    this._url = url;
    this._referrer = referrer;
    this._context = context;
  }

  public get url(): URL {
    return this._url;
  }

  public get referrer(): IDocumentReference | undefined {
    return this._referrer;
  }

  public resolve(urlOrPath: URL | string): IDocumentReference {
    if (typeof urlOrPath === "string") {
      const path = urlOrPath;

      if (path.startsWith("/") || path.startsWith("\\")) {
        if (isSubResource(this._context.baseURL, this._url)) {
          return new DocumentReference(
            new URL(`.${path}`, this._context.baseURL),
            this,
            this._context
          );
        } else {
          return new DocumentReference(
            new URL(path, this._url),
            this,
            this._context
          );
        }
      } else {
        return this.resolve(new URL(path, this._url));
      }
    } else {
      return new DocumentReference(urlOrPath, this, this._context);
    }
  }

  public toString(): string {
    return this._url.protocol === "file:"
      ? fileURLToPath(this._url)
      : this._url.toString();
  }

  fetch(): Promise<string | undefined>;
  fetch(asBinary: false): Promise<string | undefined>;
  fetch(asBinary: true): Promise<ArrayBuffer | undefined>;
  public async fetch(
    asBinary?: boolean
  ): Promise<string | ArrayBuffer | undefined> {
    const encoding = asBinary ? undefined : "utf-8";

    if (this._url.protocol === "file:") {
      const stream = createReadStream(fileURLToPath(this._url), {
        flags: "r",
        encoding: encoding,
      });

      const result: Array<Buffer | string> = [];

      for await (const item of stream) {
        result.push(item);
      }

      return asBinary
        ? Buffer.concat(result as Buffer[]).buffer
        : result.join("");
    }

    if (this._context.allowRemoteFetch) {
      const response = await fetch(this._url);
      if (!response.ok) {
        throw new Error(
          `${response.url} ${response.status}: ${response.statusText}`
        );
      }

      return (await asBinary) ? response.arrayBuffer() : response.text();
    }
  }
}

function getAuthorityAndPathname(url: URL): string {
  const { origin, username, password, pathname } = url;

  if (username !== "") {
    if (password !== "") {
      return `${origin}@${username}:${password}/${pathname}`;
    } else {
      return `${origin}@${username}/${pathname}`;
    }
  } else {
    if (password !== "") {
      return `${origin}@:${password}/${pathname}`;
    } else {
      return `${origin}/${pathname}`;
    }
  }
}

function isSubResource(parent: URL, child: URL): boolean {
  const parentHref = getAuthorityAndPathname(parent);
  const childHref = getAuthorityAndPathname(child);

  return (
    childHref.startsWith(parentHref) &&
    (childHref.length === parentHref.length ||
      childHref[parentHref.length] === "/")
  );
}
