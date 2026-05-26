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
