import { ReadStream } from "node:fs";
import csvParser from "csv-parser";
import type { IDocumentReference } from "./DocumentReference.mjs";
import type { IContent } from "./types.mjs";

interface CSVHeader {
    header: string;
}

export interface ICSVContent extends IContent {
    type: "csv";
    mimeType: "text/csv";
    headers: string[];
    rows: Array<Record<string, unknown>>;
    ref: IDocumentReference;
}

export async function fetchCSVContent(
    ref: IDocumentReference,
): Promise<ICSVContent | undefined> {
    const fetched = await ref.fetch();

    if (typeof fetched === "undefined") {
        return;
    }

    const headers: Set<string> = new Set();
    const result: Array<Record<string, unknown>> = [];

    return await new Promise<ICSVContent | undefined>((resolve, reject) => {
        ReadStream.from([fetched])
            .pipe(csvParser({ mapHeaders: trimHeader }))
            .on("data", (row: Record<string, unknown>) => {
                if (Object.keys(row).length > 0) {
                    // Skip empty rows
                    result.push(trimRow(row));
                }
            })
            .on("end", () => {
                resolve({
                    type: "csv",
                    mimeType: "text/csv",
                    headers: [...headers],
                    rows: result,
                    ref: ref,
                });
            })
            .on("error", (error) => {
                reject(error);
            });

        function trimHeader({ header }: CSVHeader): string {
            const result = header.trim();
            headers.add(result);
            return result;
        }

        function trimRow(
            row: Record<string, unknown>,
        ): Record<string, unknown> {
            for (const key in row) {
                const value = row[key];

                headers.add(key);
                if (typeof value === "string") {
                    row[key] = value.trim();
                }
            }

            return row;
        }
    });
}
