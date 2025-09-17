import { Transform } from "node:stream";
import type { EventData } from "node:test";
import type { TestEvent } from "node:test/reporters";

class HtmlReporter extends Transform {
    private _lastTestSummary?: EventData.TestSummary;
    private _lastCoverageSummary?: EventData.TestCoverage;

    constructor() {
        super({ writableObjectMode: true });
    }

    _transform(event: TestEvent, _encoding: string, callback: () => void) {
        switch (event.type) {
            case "test:summary": {
                this._lastTestSummary = event.data;

                break;
            }

            case "test:coverage": {
                this._lastCoverageSummary = event.data;

                break;
            }
        }

        callback();
    }

    _flush(callback) {
        if (this._lastTestSummary) {
            const { tests, passed, cancelled, skipped, todo, suites } =
                this._lastTestSummary.counts;
            const { duration_ms } = this._lastTestSummary;
            const failed = tests - (passed + cancelled + skipped + todo);

            this._markdownHeading("Test Summary");

            this._markdownTable([
                {
                    Suites: suites,
                    Tests: tests,
                    Passed: passed,
                    Failed: failed,
                    Cancelled: cancelled,
                    Skipped: skipped,
                    "To Do": todo,
                    Duration: `${duration_ms.toFixed(1)}ms`,
                },
            ]);
        }

        if (this._lastCoverageSummary) {
            const {
                coveredLinePercent,
                coveredFunctionPercent,
                coveredBranchPercent,
            } = this._lastCoverageSummary.summary.totals;

            this._markdownHeading("Coverage Summary");

            this._markdownTable([
                {
                    Lines: `${coveredLinePercent.toFixed(1)}%`,
                    Functions: `${coveredFunctionPercent.toFixed(1)}%`,
                    Branches: `${coveredBranchPercent.toFixed(1)}%`,
                },
            ]);
        }

        callback();
    }

    private _markdownHeading(value: string): void {
        this.push(`### ${value}\n\n`);
    }

    private _markdownTable(rows: Record<string, unknown>[]): void {
        const headers: Set<string> = new Set();

        for (const row of rows) {
            for (const name of Object.keys(row)) {
                headers.add(name);
            }
        }

        this.push("|");
        for (const header of headers) {
            this.push(" ");
            this.push(header);
            this.push(" |");
        }
        this.push("\n");

        this.push("| ");
        for (const _ of headers) {
            this.push(" :--- |");
        }
        this.push("\n");

        for (const row of rows) {
            this.push("| ");
            for (const header of headers) {
                const value = row[header];

                this.push(" ");
                if (typeof value !== "undefined" && value !== null) {
                    this.push(String(value));
                }
                this.push(" |");
            }
            this.push("\n");
        }

        this.push("\n");
    }
}

export default new HtmlReporter();
