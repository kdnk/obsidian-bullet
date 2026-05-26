# bullet:move-list-item-down should move line down

- applyState:

```md
- one|
- two
```

- execute: `bullet:move-list-item-down`
- assertState:

```md
- two
- one|
```

# bullet:move-list-item-down should move children down

- applyState:

```md
- one|
  - one one
- two
```

- execute: `bullet:move-list-item-down`
- assertState:

```md
- two
- one|
  - one one
```

# bullet:move-list-item-up should move line up

- applyState:

```md
- one
- two|
```

- execute: `bullet:move-list-item-up`
- assertState:

```md
- two|
- one
```

# bullet:move-list-item-up should move children up

- applyState:

```md
- two
- one|
  - one one
```

- execute: `bullet:move-list-item-up`
- assertState:

```md
- one|
  - one one
- two
```

# bullet:indent-list should indent line

- applyState:

```md
- qwe
- qwe|
```

- execute: `bullet:indent-list`
- assertState:

```md
- qwe
  - qwe|
```

# bullet:indent-list should indent children

- applyState:

```md
- qwe
- qwe|
  - qwe
```

- execute: `bullet:indent-list`
- assertState:

```md
- qwe
  - qwe|
    - qwe
```

# bullet:indent-list should not indent line if it's no parent

- applyState:

```md
- qwe
  - qwe|
```

- execute: `bullet:indent-list`
- assertState:

```md
- qwe
  - qwe|
```

# bullet:indent-list should keep cursor at the same text position

- applyState:

```md
- qwe
  - qwe
  - q|we
```

- execute: `bullet:indent-list`
- assertState:

```md
- qwe
  - qwe
    - q|we
```

# bullet:indent-list should keep numeration

- applyState:

```md
- one
  1. two
  2. three|
  3. four
```

- execute: `bullet:indent-list`
- assertState:

```md
- one
  1. two
    1. three|
  2. four
```

# bullet:outdent-list should outdent line

- applyState:

```md
- qwe
  - qwe|
```

- execute: `bullet:outdent-list`
- assertState:

```md
- qwe
- qwe|
```

# bullet:outdent-list should outdent children

- applyState:

```md
- qwe
  - qwe|
    - qwe
```

- execute: `bullet:outdent-list`
- assertState:

```md
- qwe
- qwe|
  - qwe
```

# bullet:outdent-list should outdent in case #144

- applyState:

```md
- qwe
  - qwe
    - qwe
  - qwe
  - qwe|
```

- execute: `bullet:outdent-list`
- assertState:

```md
- qwe
  - qwe
    - qwe
  - qwe
- qwe|
```
