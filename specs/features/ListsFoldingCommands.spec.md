# should fold

- applyState:

```md
- one|
  - two
```

- execute: `bullet:fold`
- assertState:

```md
- one| #folded
  - two
```
