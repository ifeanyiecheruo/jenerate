# jenerate

Command line static site generator for https://jenadairlab.com

[![CI](https://github.com/ifeanyiecheruo/jenerate/actions/workflows/ci.yaml/badge.svg)](https://github.com/ifeanyiecheruo/jenerate/actions/workflows/ci.yaml)

## Installing

TODO

## Syntax

`jenerate [--verbose|-v] [--watch|-w] {--from|-f <src-path>} {--to|-t <destination-path>} [--update-delay|d <update-delay>] [<source-glob>+]`

### Flags

- `--verbose|-v`: Emit verbose logs.
- `--watch|-w`: Do not exit until ESC is pressed and rejenerate when inputs or their dependencies change.

### Switches

- `--from|-f <src-path>`: Only accept files under `<src-path>` as inputs.
- `--to|-t <destination-path>`: Emit generated output to `<destination-path>`.
- `--update-delay|-d <update-delay>`: Wait up to `<update-delay>` seconds after an input or its dependency has changed before rejenerating.

### Arguments

- `source-glob`: Input files to generate. [Glob patterns](https://www.google.com/search?q=glob+pattern+syntax+and+examples) are supported.

## Concepts

The generator works by scanning a folder for [HTNL files](https://en.wikipedia.org/wiki/HTML), optionally processing them, and copying the result (including dependencies) to a destination.
Processing includes...

- Pasting common snippets into HTML files for content that needs be consistent on multiple pages; think banners or a navigation menu.
- Using the rows of [CSV files](https://en.wikipedia.org/wiki/Comma-separated_values) to fill in placeholders in templates. Usefull for data driven listings.

## Working with Snippets

An HTML file pulls in a snippet using the `<x-jen-snippet>` tag

```html
<div>
    <p>The line below will contain the contents of ./example.snippet.html after building</p>
    <x-jen-snippet src="./example.snippet.html"></x-jen-snippet>
    <p>The line above will contain the contents of ./example.snippet.html after building</p>
</div>
```

## Working with CSV data

The site uses CSV data to generate lists of similar items.

Lets start with an example.

```html
<ul>
    <!-- 
        The next line pulls rows from items.csv, selects specific columns.
        The inside of <x-jen-from-data> will be repeated for For each row in items.csv
        Each instance of <%= column-name %> will be replaced with the corresponding row
    -->
    <x-jen-from-data src="./items.csv" select="date, title, summary, link">
        <li>
            <article>
                <h1><a alt="<%= title %>" href="<%=link %>"><%= title %></a></h1>
                <p>
                    <time><%= date %></time>
                    <span><%= summary %></span>
                </p>
            </article>
        </li>
    </x-jen-from-data>
</ul>
```

If the contents of `./items.csv` were

```csv
date,        title,                             summary,                                                                            link
Jun 17 1958, Things Fall Apart,                 Things Fall Apart is a 1958 novel by Nigerian author Chinua Achebe,                 https://en.wikipedia.org/wiki/Things_Fall_Apart
Aug 12 1854, Hard Times,                        Tenth novel by English author Charles Dickens,                                      https://gutenberg.org/ebooks/786
Dec 10 1884, Adventures of Huckleberry Finn,    Adventures of Huckleberry Finn is a picaresque novel by American author Mark Twain, https://gutenberg.org/ebooks/19640
```

Then the final generated HTML would be

```html
<ul>
    <li>
        <article>
            <h1><a alt="Things Fall Apart" href="https://en.wikipedia.org/wiki/Things_Fall_Apart">Things Fall Apart</a></h1>
            <p>
                <time>Jun 17 1958</time>
                <span>Things Fall Apart is a 1958 novel by Nigerian author Chinua Achebe</span>
            </p>
        </article>
    </li>
    <li>
        <article>
            <h1><a alt="Hard Times" href="https://gutenberg.org/ebooks/786">Hard Times</a></h1>
            <p>
                <time>Aug 12 1854</time>
                <span>Tenth novel by English author Charles Dickens</span>
            </p>
        </article>
    </li>
    <li>
        <article>
            <h1><a alt="Adventures of Huckleberry Finn" href="https://gutenberg.org/ebooks/19640">Adventures of Huckleberry Finn</a></h1>
            <p>
                <time>Dec 10 1884</time>
                <span>Adventures of Huckleberry Finn is a picaresque novel by American author Mark Twain</span>
            </p>
        </article>
    </li>
</ul>
```
