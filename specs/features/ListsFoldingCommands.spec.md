# should fold

- applyState:

```md
- one|
  - two
```

- execute: `outliner-plus:fold`
- assertState:

```md
- one| #folded
  - two
```
