# direct body typing should create a bullet

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
|
```

- typeText: `a`
- assertState:

```md
- a|
```

# undo should revert typed text and its bullet correction together

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
|
```

- typeText: `a`
- execute: `editor:undo`
- assertState:

```md
|
```

# typing should correct only the touched plain-text line

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
pasted|
untouched
```

- typeText: `!`
- assertState:

```md
- pasted!|
untouched
```

# pasted text should remain unowned

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
|
```

- pasteText: `pasted`
- assertState:

```md
pasted|
```

# programmatic text insertion should remain unowned

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
|
```

- insertText: `programmatic`
- assertState:

```md
programmatic|
```

# direct typing should create the same bullet when cursor sticking is disabled

- setting: `keepBodyTextInBullets=true`
- setting: `stickCursor="never"`
- applyState:

```md
|
```

- typeText: `a`
- assertState:

```md
- a|
```

# direct typing should create the same bullet when cursor sticking is enabled

- setting: `keepBodyTextInBullets=true`
- setting: `stickCursor="bullet-and-checkbox"`
- applyState:

```md
|
```

- typeText: `a`
- assertState:

```md
- a|
```

# typing in a list continuation should not create another bullet

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- parent
  continuatio|
```

- typeText: `n`
- assertState:

```md
- parent
  continuation|
```

# deleting part of a list marker as typed input should keep the body owned

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
|-| item
```

- typeText: ""
- assertState:

```md
- | item
```

# deleting a whole list line selection should not restore the item

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
|- one
|- two
```

- typeText: ""
- assertState:

```md
|- two
```

# a heading trigger should promote an empty root item

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- |
```

- typeText: `#`
- assertState:

```md
#|
```

# a quote trigger should promote an empty root item

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- |
```

- typeText: `>`
- assertState:

```md
>|
```

# a backtick trigger should promote an empty root item

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- |
```

- typeText: "\u0060"
- assertState:

```md
`|
```

# a horizontal rule should remain a root structure

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- |
```

- typeText: `-`
- typeText: `--`
- assertState:

```md
---|
```

# a fenced-code opener should remain a root structure

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- |
```

- typeText: "\u0060"
- typeText: "\u0060\u0060"
- assertState:

````md
```|
````

# a nested empty item should not be promoted

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- parent
  - |
```

- typeText: `#`
- assertState:

```md
- parent
  - #|
```

# an empty task item should not be promoted

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- [ ] |
```

- typeText: `>`
- assertState:

```md
- [ ] >|
```

# typing inside frontmatter should not create a bullet

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
---
title: Exampl|
---
```

- typeText: `e`
- assertState:

```md
---
title: Example|
---
```

# typing inside fenced code should not create a bullet

- setting: `keepBodyTextInBullets=true`
- applyState:

````md
```
cod|
```
````

- typeText: `e`
- assertState:

````md
```
code|
```
````
