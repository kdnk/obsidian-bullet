import { ChangeSet, Text } from "@codemirror/state";

import {
  expandCompactCodeBlocks,
  hasExpandableCodeBlockAncestor,
} from "../expandCompactCodeBlocks";

function expand(source: string) {
  const doc = Text.of(source.split("\n"));
  return ChangeSet.of(expandCompactCodeBlocks(doc), doc.length)
    .apply(doc)
    .toString();
}

test("restores the empty parent row without changing formatted code bytes", () => {
  expect(
    expand(
      "-   - ```js\n      const child = 1;\n\n        - literal\n      ```\n- after\n",
    ),
  ).toBe(
    "- \n    - ```js\n      const child = 1;\n\n        - literal\n      ```\n- after\n",
  );
});

test.each([
  "- \n\t- ```js\n\t  code\n\t  ```",
  "-\n\t- ```js\n\t  code\n\t  ```",
  "- parent\n\t- \n\t\t- ~~~\n\t\t  code\n\t\t  ~~~",
  "-   - ```js\n      code\n      ```",
])("recognizes a formatter-vulnerable empty ancestor in %j", (source) => {
  expect(hasExpandableCodeBlockAncestor(source)).toBe(true);
});

test.each([
  "- parent\n\t- ```js\n\t  code\n\t  ```",
  "- \n- ```js\n  code\n  ```",
  "- \n\t- ordinary text",
  "````md\n- \n\t- ```js\n\t  code\n\t  ```\n````",
  "- ```md\n  - \n      - ```js\n        literal\n        ```\n  ```",
])("leaves the original formatter path for %j", (source) => {
  expect(hasExpandableCodeBlockAncestor(source)).toBe(false);
});

test("expands repeated ordered ancestors at their existing columns", () => {
  expect(expand("9.  -   12. ~~~~txt\n            a\n            ~~~~")).toBe(
    "9. \n    - \n        12. ~~~~txt\n            a\n            ~~~~",
  );
});

test("keeps the original nested indentation and separator tab stops", () => {
  expect(expand("- parent\n\t-\t-\t```js\n\t\t\tcode\n\t\t\t```")).toBe(
    "- parent\n\t-\t\n\t \t-\t```js\n\t\t\tcode\n\t\t\t```",
  );
});

test("preserves the formatter's space indentation", () => {
  expect(expand("-   - ```\n      code\n      ```")).toBe(
    "- \n    - ```\n      code\n      ```",
  );
});

test.each([
  "````md\n-   - ```js\n      literal\n      ```\n````",
  "- ```md\n  -   - ```js\n        literal\n        ```\n  ```",
  "    -   - ```js\n          literal\n          ```",
  "- parent\n      -   - ```js\n            literal\n            ```",
  "-     - ```js\n        indented code",
  "- - ordinary text",
])("preserves literal code and unrelated Markdown %j", (source) => {
  expect(expand(source)).toBe(source);
});

test("expansion is stable on subsequent passes", () => {
  const source = "-   - ```\n      code\n      ```";
  const expanded = expand(source);
  expect(expand(expanded)).toBe(expanded);
});

test("keeps the empty parent's caret before the restored child row", () => {
  const doc = Text.of(["-   - ```", "      code", "      ```"]);
  const changes = ChangeSet.of(expandCompactCodeBlocks(doc), doc.length);
  expect(changes.mapPos(2)).toBe(2);
});

test.each([
  ["<pre>", "</pre>"],
  ["<script>", "</script>"],
  ["<style>", "</style>"],
  ["<textarea>", "</textarea>"],
  ["<!--", "-->"],
  ["<![CDATA[", "]]>"],
  ["<?processing", "?>"],
  ["<div>", "</div>"],
])("preserves literal list fences in %s HTML blocks", (start, end) => {
  const source = `${start}\n-   - \`\`\`js\n      code\n      \`\`\`\n${end}\n`;
  expect(expand(source)).toBe(source);
  expect(hasExpandableCodeBlockAncestor(source)).toBe(false);
  const following = source + "\n-   - ```js\n      real code\n      ```";
  expect(expand(following)).toBe(
    source + "\n- \n    - ```js\n      real code\n      ```",
  );
});

test.each(["- <br>", "- <pre>", "<span>heading</span>"])(
  "recognizes a vulnerable sibling after %s",
  (html) => {
    const source = html + "\n- \n\t- ```js\n\t  code\n\t  ```";
    expect(hasExpandableCodeBlockAncestor(source)).toBe(true);
    const formatted = html + "\n-   - ```js\n      code\n      ```";
    expect(expand(formatted)).toBe(
      html + "\n- \n    - ```js\n      code\n      ```",
    );
  },
);
