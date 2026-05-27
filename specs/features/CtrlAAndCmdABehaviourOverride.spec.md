# cmd-a should select list item content

- platform: `darwin`
- applyState:

```md
- one
  - two|
```

- keydown: `Cmd-KeyA`
- assertState:

```md
- one
  - |two|
```

# ctrl-a should select list item content

- platform: `linux`
- applyState:

```md
- one
  - two|
```

- keydown: `Ctrl-KeyA`
- assertState:

```md
- one
  - |two|
```

# cmd-a should select list item content excluding checkbox

- platform: `darwin`
- applyState:

```md
- one
  - [ ] two|
```

- keydown: `Cmd-KeyA`
- assertState:

```md
- one
  - [ ] |two|
```

# ctrl-a should select list item content excluding checkbox

- platform: `linux`
- applyState:

```md
- one
  - [ ] two|
```

- keydown: `Ctrl-KeyA`
- assertState:

```md
- one
  - [ ] |two|
```

# cmd-a should select list item content excluding custom checkbox

- platform: `darwin`
- applyState:

```md
- one
    - [!] two|
```

- keydown: `Cmd-KeyA`
- assertState:

```md
- one
    - [!] |two|
```

# ctrl-a should select list item content excluding custom checkbox

- platform: `linux`
- applyState:

```md
- one
    - [!] two|
```

- keydown: `Ctrl-KeyA`
- assertState:

```md
- one
    - [!] |two|
```

# cmd-a should select list item content with notes

- platform: `darwin`
- applyState:

```md
- one
  - two|
    notes
```

- keydown: `Cmd-KeyA`
- assertState:

```md
- one
  - |two
    notes|
```

# ctrl-a should select list item content with notes

- platform: `linux`
- applyState:

```md
- one
  - two|
    notes
```

- keydown: `Ctrl-KeyA`
- assertState:

```md
- one
  - |two
    notes|
```

# cmd-a should select list whole list after second invoke

- platform: `darwin`
- applyState:

```md
a
- one
  - two|
b
```

- keydown: `Cmd-KeyA`
- keydown: `Cmd-KeyA`
- assertState:

```md
a
|- one
  - two|
b
```

# ctrl-a should select list whole list after second invoke

- platform: `linux`
- applyState:

```md
a
- one
  - two|
b
```

- keydown: `Ctrl-KeyA`
- keydown: `Ctrl-KeyA`
- assertState:

```md
a
|- one
  - two|
b
```

# cmd-a should cycle parent item selection through content subtree root list and content

- platform: `darwin`
- applyState:

```md
- item 1
- item 2|
  - item 2.1
  - item 2.2
- item 3
```

- keydown: `Cmd-KeyA`
- keydown: `Cmd-KeyA`
- keydown: `Cmd-KeyA`
- keydown: `Cmd-KeyA`
- assertState:

```md
- item 1
- |item 2|
  - item 2.1
  - item 2.2
- item 3
```

# ctrl-a should cycle parent item selection through content subtree root list and content

- platform: `linux`
- applyState:

```md
- item 1
- item 2|
  - item 2.1
  - item 2.2
- item 3
```

- keydown: `Ctrl-KeyA`
- keydown: `Ctrl-KeyA`
- keydown: `Ctrl-KeyA`
- keydown: `Ctrl-KeyA`
- assertState:

```md
- item 1
- |item 2|
  - item 2.1
  - item 2.2
- item 3
```

# cmd-a should select only the parent subtree from a nested item

- platform: `darwin`
- applyState:

```md
- parent 1
  - child 1.1
- parent 2
  - child 2.1|
  - child 2.2
- parent 3
```

- keydown: `Cmd-KeyA`
- keydown: `Cmd-KeyA`
- assertState:

```md
- parent 1
  - child 1.1
|- parent 2
  - child 2.1
  - child 2.2|
- parent 3
```

# ctrl-a should select only the parent subtree from a nested item

- platform: `linux`
- applyState:

```md
- parent 1
  - child 1.1
- parent 2
  - child 2.1|
  - child 2.2
- parent 3
```

- keydown: `Ctrl-KeyA`
- keydown: `Ctrl-KeyA`
- assertState:

```md
- parent 1
  - child 1.1
|- parent 2
  - child 2.1
  - child 2.2|
- parent 3
```

# cmd-a should cycle checkbox item without selecting checkbox markup

- platform: `darwin`
- applyState:

```md
- [ ] task 1
- [ ] task 2|
```

- keydown: `Cmd-KeyA`
- keydown: `Cmd-KeyA`
- keydown: `Cmd-KeyA`
- assertState:

```md
- [ ] task 1
- [ ] |task 2|
```

# ctrl-a should cycle checkbox item without selecting checkbox markup

- platform: `linux`
- applyState:

```md
- [ ] task 1
- [ ] task 2|
```

- keydown: `Ctrl-KeyA`
- keydown: `Ctrl-KeyA`
- keydown: `Ctrl-KeyA`
- assertState:

```md
- [ ] task 1
- [ ] |task 2|
```
