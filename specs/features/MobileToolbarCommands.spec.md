# bullet:select-list-content should select list item content

- applyState:

```md
- one
  - two|
```

- execute: `bullet:select-list-content`
- assertState:

```md
- one
  - |two|
```

# bullet:select-list-content should select the whole list on second invoke

- applyState:

```md
a
- one
  - two|
b
```

- execute: `bullet:select-list-content`
- execute: `bullet:select-list-content`
- assertState:

```md
a
|- one
  - two|
b
```

# bullet:select-list-content should cycle parent item through content subtree root list and content

- applyState:

```md
- item 1
- item 2|
  - item 2.1
  - item 2.2
- item 3
```

- execute: `bullet:select-list-content`
- execute: `bullet:select-list-content`
- execute: `bullet:select-list-content`
- execute: `bullet:select-list-content`
- assertState:

```md
- item 1
- |item 2|
  - item 2.1
  - item 2.2
- item 3
```

# bullet:select-list-content should select only the parent subtree from a nested item

- applyState:

```md
- parent 1
  - child 1.1
- parent 2
  - child 2.1|
  - child 2.2
- parent 3
```

- execute: `bullet:select-list-content`
- execute: `bullet:select-list-content`
- assertState:

```md
- parent 1
  - child 1.1
|- parent 2
  - child 2.1
  - child 2.2|
- parent 3
```

# bullet:select-list-content should cycle checkbox item without selecting checkbox markup

- applyState:

```md
- [ ] task 1
- [ ] task 2|
```

- execute: `bullet:select-list-content`
- execute: `bullet:select-list-content`
- execute: `bullet:select-list-content`
- assertState:

```md
- [ ] task 1
- [ ] |task 2|
```

# bullet:insert-note-line should create a note line

- applyState:

```md
- one|
  - two
```

- execute: `bullet:insert-note-line`
- assertState:

```md
- one
  |
  - two
```

# bullet:insert-note-line should split an existing note line

- applyState:

```md
- one
  no|te
```

- execute: `bullet:insert-note-line`
- assertState:

```md
- one
  no
  |te
```
