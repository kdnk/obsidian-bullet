# enter should create new item on the child level if child exists and current item has notes

- applyState:

```md
- one
  - two|
    note
    - three
```

- keydown: `Enter`
- assertState:

```md
- one
  - two
  - |
    note
    - three
```

# enter should create new item on the child level if child exists and previous item has notes

- applyState:

```md
- one
  note
  - two|
    - three
```

- keydown: `Enter`
- assertState:

```md
- one
  note
  - two
    - |
    - three
```

# enter should create new item on the child level if child exists

- applyState:

```md
- one
  - two|
    - three
```

- keydown: `Enter`
- assertState:

```md
- one
  - two
    - |
    - three
```

# enter should create new item on the child level if child exists and item have notes

- applyState:

```md
- one
  - two
    notes|
    - three
```

- keydown: `Enter`
- assertState:

```md
- one
  - two
    notes
    - |
    - three
```

# enter should create new item on the same level

- applyState:

```md
- one
  - two|
```

- keydown: `Enter`
- assertState:

```md
- one
  - two
  - |
```

# enter should create new item on the same level and split the text

- applyState:

```md
- one
  - tw|o
```

- keydown: `Enter`
- assertState:

```md
- one
  - tw
  - |o
```

# enter should outdent line if line is empty

- applyState:

```md
- one
  - two
    - |
```

- keydown: `Enter`
- assertState:

```md
- one
  - two
  - |
```

# enter should outdent line if line is empty and list using TAB after bullet

- applyState:

```md
-	one
	-	two
		-	|
```

- keydown: `Enter`
- assertState:

```md
-	one
	-	two
	-	|
```

# enter should outdent line if line is empty and previous line has notes

- applyState:

```md
- one
  - two
    note
    - |
```

- keydown: `Enter`
- assertState:

```md
- one
  - two
    note
  - |
```

# enter should preserve an empty root item and create a sibling below its subtree when body ownership is enabled

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- |
  - child
- after
```

- keydown: `Enter`
- assertState:

```md
- 
  - child
- |
- after
```

# enter should outdent an empty nested item and its subtree once when body ownership is enabled

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- parent
  - |
    - child
- after
```

- keydown: `Enter`
- assertState:

```md
- parent
- |
  - child
- after
```

# enter should delete list item if it's last item and body ownership is disabled

- setting: `keepBodyTextInBullets=false`
- applyState:

```md
- one
- |
```

- keydown: `Enter`
- assertState:

```md
- one
|
```

# enter should delete checkbox item if it's last item and body ownership is disabled

- setting: `keepBodyTextInBullets=false`
- applyState:

```md
- [ ] one
- [ ] |
```

- keydown: `Enter`
- assertState:

```md
- [ ] one
|
```

# enter should create checkbox if current item contains checkbox

- applyState:

```md
- [ ] one|
```

- keydown: `Enter`
- assertState:

```md
- [ ] one
- [ ] |
```

# enter should create unchecked checkbox if current item contains checked checkbox

- applyState:

```md
- [x] one|
```

- keydown: `Enter`
- assertState:

```md
- [x] one
- [ ] |
```

# enter should keep the original checked checkbox when inserting above it

- applyState:

```md
- [x] |checked task
```

- keydown: `Enter`
- assertState:

```md
- [ ] |
- [x] checked task
```

# enter should create unchecked checkbox if current item contains checkbox with custom state

- applyState:

```md
- [!] one|
```

- keydown: `Enter`
- assertState:

```md
- [!] one
- [ ] |
```

# enter should create checkbox if current item contains checkbox and cursor on notes

- applyState:

```md
- [ ] one
  qwe|
```

- keydown: `Enter`
- assertState:

```md
- [ ] one
  qwe
- [ ] |
```

# enter should create checkbox and split text if current item contains checkbox and cursor inside text

- applyState:

```md
- [ ] one
  q|we
```

- keydown: `Enter`
- assertState:

```md
- [ ] one
  q
- [ ] |we
```

# enter should not create checkbox if current item contains checkbox but cursor inside checkbox

- setting: `stickCursor="never"`
- applyState:

```md
- [| ] one
```

- keydown: `Enter`
- assertState:

```md
- [
- | ] one
```

# enter should not create new item if cursor is before line start

- setting: `stickCursor="never"`
- applyState:

```md
- one
|- two
```

- keydown: `Enter`
- assertState:

```md
- one

|- two
```

# enter should copy TAB after bullet point

- applyState:

```md
-	one
	-	two|
```

- keydown: `Enter`
- assertState:

```md
-	one
	-	two
	-	|
```

# enter should create new item on the same level and remove selection

- applyState:

```md
-	one
	-	two|three|
```

- keydown: `Enter`
- assertState:

```md
-	one
	-	two
	-	|
```

# enter should create new item on the same level and remove selection between words

- applyState:

```md
-	one
	-	two|three|four
```

- keydown: `Enter`
- assertState:

```md
-	one
	-	two
	-	|four
```

# enter should fallback behavior while multiline selection

- applyState:

```md
-	one
	-	two|three
- four|five
```

- keydown: `Enter`
- assertState:

```md
-	one
	-	two
	|five
```

# enter should fallback behavior while multiline selection with nested bullets

- applyState:

```md
-	1|one
	-	two |three
- four
```

- keydown: `Enter`
- assertState:

```md
-	1
|three
- four
```
