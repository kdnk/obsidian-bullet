# Formatter source notices

Bullet includes selected formatter source adapted from the following MIT-licensed projects.

- Obsidian Linter, revision `7cef0fbf828dd5a9cd9f4d443083b889f06c3f36`. Selected rule implementations and their Markdown parsing, ignored-region, string and regular expression helpers live in `src/formatting/vendor/`. The plugin UI, registration, translations, inactive rules and settings machinery are excluded. Parser positions are validated for strict TypeScript, the task-list Markdown extension factory is called explicitly, and the parser cache is bounded. UTC timestamps without zone tokens are parsed and compared in UTC to keep repeated formatting stable. `src/formatting/__tests__/fixtures/linter-examples.json` contains the selected upstream rule examples with their original literal expected output and options.
- Obsidian Prettier, revision `af03b59ea2077b4e80d650a7efdedc1885594cf6`. The safe Markdown formatter, editor diff and scroll snapshot helpers live in `src/formatting/prettier.ts`, `editorChanges.ts` and `formattingScroll.ts`.

## Obsidian Linter license

MIT License

Copyright (c) 2021-2022 Victor Tao

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Obsidian Prettier license

Copyright (c) 2025 by Dylan Armstrong
Copyright (c) 2026 by Kodai Nakamura

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
