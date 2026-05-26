# should fold

- applyState:

```md
- one|
  - two
```

- execute: `obsidian-outliner-plus:fold`
- assertState:

```md
- one| #folded
  - two
```
