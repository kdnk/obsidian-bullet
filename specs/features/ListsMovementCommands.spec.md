# obsidian-outliner-plus:move-list-item-down should move line down

- applyState:

```md
- one|
- two
```

- execute: `obsidian-outliner-plus:move-list-item-down`
- assertState:

```md
- two
- one|
```

# obsidian-outliner-plus:move-list-item-down should move children down

- applyState:

```md
- one|
  - one one
- two
```

- execute: `obsidian-outliner-plus:move-list-item-down`
- assertState:

```md
- two
- one|
  - one one
```

# obsidian-outliner-plus:move-list-item-up should move line up

- applyState:

```md
- one
- two|
```

- execute: `obsidian-outliner-plus:move-list-item-up`
- assertState:

```md
- two|
- one
```

# obsidian-outliner-plus:move-list-item-up should move children up

- applyState:

```md
- two
- one|
  - one one
```

- execute: `obsidian-outliner-plus:move-list-item-up`
- assertState:

```md
- one|
  - one one
- two
```

# obsidian-outliner-plus:indent-list should indent line

- applyState:

```md
- qwe
- qwe|
```

- execute: `obsidian-outliner-plus:indent-list`
- assertState:

```md
- qwe
  - qwe|
```

# obsidian-outliner-plus:indent-list should indent children

- applyState:

```md
- qwe
- qwe|
  - qwe
```

- execute: `obsidian-outliner-plus:indent-list`
- assertState:

```md
- qwe
  - qwe|
    - qwe
```

# obsidian-outliner-plus:indent-list should not indent line if it's no parent

- applyState:

```md
- qwe
  - qwe|
```

- execute: `obsidian-outliner-plus:indent-list`
- assertState:

```md
- qwe
  - qwe|
```

# obsidian-outliner-plus:indent-list should keep cursor at the same text position

- applyState:

```md
- qwe
  - qwe
  - q|we
```

- execute: `obsidian-outliner-plus:indent-list`
- assertState:

```md
- qwe
  - qwe
    - q|we
```

# obsidian-outliner-plus:indent-list should keep numeration

- applyState:

```md
- one
  1. two
  2. three|
  3. four
```

- execute: `obsidian-outliner-plus:indent-list`
- assertState:

```md
- one
  1. two
    1. three|
  2. four
```

# obsidian-outliner-plus:outdent-list should outdent line

- applyState:

```md
- qwe
  - qwe|
```

- execute: `obsidian-outliner-plus:outdent-list`
- assertState:

```md
- qwe
- qwe|
```

# obsidian-outliner-plus:outdent-list should outdent children

- applyState:

```md
- qwe
  - qwe|
    - qwe
```

- execute: `obsidian-outliner-plus:outdent-list`
- assertState:

```md
- qwe
- qwe|
  - qwe
```

# obsidian-outliner-plus:outdent-list should outdent in case #144

- applyState:

```md
- qwe
  - qwe
    - qwe
  - qwe
  - qwe|
```

- execute: `obsidian-outliner-plus:outdent-list`
- assertState:

```md
- qwe
  - qwe
    - qwe
  - qwe
- qwe|
```
