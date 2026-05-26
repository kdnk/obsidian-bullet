# should ignore space on last line


- applyState:

```md
- one
  - two
  - three|
 
```

- execute: `outliner-plus:move-list-item-up`
- assertState:

```md
- one
  - three|
  - two
 
```
