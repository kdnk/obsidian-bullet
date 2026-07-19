# backspace should work as regular if it's last empty line and body ownership is disabled

- setting: `keepBodyTextInBullets=false`
- applyState:

```md
- |
```

- keydown: `Backspace`
- assertState:

```md
-|
```

# backspace should work as regular if it's first line without children and body ownership is disabled

- setting: `keepBodyTextInBullets=false`
- applyState:

```md
- |one
- two
```

- keydown: `Backspace`
- assertState:

```md
-|one
- two
```

# backspace should do nothing if it's first line with children

- applyState:

```md
- |one
  - two
```

- keydown: `Backspace`
- assertState:

```md
- |one
  - two
```

# backspace should remove symbol if it isn't empty line

- applyState:

```md
- qwe|
```

- keydown: `Backspace`
- assertState:

```md
- qw|
```

# backspace should remove list item if it's empty

- applyState:

```md
- one
- |
```

- keydown: `Backspace`
- assertState:

```md
- one|
```

# backspace should remove the only empty root item when body ownership is enabled

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- |
```

- keydown: `Backspace`
- assertState:

```md
|
```

# backspace should remove a nested empty item when body ownership is enabled

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- parent
  - |
  - sibling
```

- keydown: `Backspace`
- assertState:

```md
- parent|
  - sibling
```

# backspace should remove a nested empty item without trailing marker space

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- parent
  -|
```

- keydown: `Backspace`
- assertState:

```md
- parent|
```

# backspace should remove a middle root item when body ownership is enabled

- setting: `keepBodyTextInBullets=true`
- applyState:

```md
- previous
- |
- next
```

- keydown: `Backspace`
- assertState:

```md
- previous|
- next
```

# backspace should remove note line if it's empty

- applyState:

```md
- one
  |
```

- keydown: `Backspace`
- assertState:

```md
- one|
```

# backspace should remove note line if it isn't empty and cursor on the line start

- applyState:

```md
- one
  |two
```

- keydown: `Backspace`
- assertState:

```md
- one|two
```
