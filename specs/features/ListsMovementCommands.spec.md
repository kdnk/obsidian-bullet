# outliner-plus:move-list-item-down should move line down

- applyState:

```md
- one|
- two
```

- execute: `outliner-plus:move-list-item-down`
- assertState:

```md
- two
- one|
```

# outliner-plus:move-list-item-down should move children down

- applyState:

```md
- one|
  - one one
- two
```

- execute: `outliner-plus:move-list-item-down`
- assertState:

```md
- two
- one|
  - one one
```

# outliner-plus:move-list-item-up should move line up

- applyState:

```md
- one
- two|
```

- execute: `outliner-plus:move-list-item-up`
- assertState:

```md
- two|
- one
```

# outliner-plus:move-list-item-up should move children up

- applyState:

```md
- two
- one|
  - one one
```

- execute: `outliner-plus:move-list-item-up`
- assertState:

```md
- one|
  - one one
- two
```

# outliner-plus:indent-list should indent line

- applyState:

```md
- qwe
- qwe|
```

- execute: `outliner-plus:indent-list`
- assertState:

```md
- qwe
  - qwe|
```

# outliner-plus:indent-list should indent children

- applyState:

```md
- qwe
- qwe|
  - qwe
```

- execute: `outliner-plus:indent-list`
- assertState:

```md
- qwe
  - qwe|
    - qwe
```

# outliner-plus:indent-list should not indent line if it's no parent

- applyState:

```md
- qwe
  - qwe|
```

- execute: `outliner-plus:indent-list`
- assertState:

```md
- qwe
  - qwe|
```

# outliner-plus:indent-list should keep cursor at the same text position

- applyState:

```md
- qwe
  - qwe
  - q|we
```

- execute: `outliner-plus:indent-list`
- assertState:

```md
- qwe
  - qwe
    - q|we
```

# outliner-plus:indent-list should keep numeration

- applyState:

```md
- one
  1. two
  2. three|
  3. four
```

- execute: `outliner-plus:indent-list`
- assertState:

```md
- one
  1. two
    1. three|
  2. four
```

# outliner-plus:outdent-list should outdent line

- applyState:

```md
- qwe
  - qwe|
```

- execute: `outliner-plus:outdent-list`
- assertState:

```md
- qwe
- qwe|
```

# outliner-plus:outdent-list should outdent children

- applyState:

```md
- qwe
  - qwe|
    - qwe
```

- execute: `outliner-plus:outdent-list`
- assertState:

```md
- qwe
- qwe|
  - qwe
```

# outliner-plus:outdent-list should outdent in case #144

- applyState:

```md
- qwe
  - qwe
    - qwe
  - qwe
  - qwe|
```

- execute: `outliner-plus:outdent-list`
- assertState:

```md
- qwe
  - qwe
    - qwe
  - qwe
- qwe|
```
