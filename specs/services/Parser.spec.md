# should ignore space on last line


- applyState:

```md
- one
  - two
  - three|
 
```

- execute: `bullet:move-list-item-up`
- assertState:

```md
- one
  - three|
  - two
 
```
