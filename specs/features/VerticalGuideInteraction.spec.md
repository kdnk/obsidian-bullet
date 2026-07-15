# persistent indent guide should reopen and refold a saved branch

- applyState:

```md
- parent|
  - branch #folded
    - child
```

- clickGuide: {"line":1,"kind":"indent","prefix":""}
- assertState:

```md
- parent|
  - branch
    - child
```

- clickGuide: {"line":1,"kind":"indent","prefix":""}
- assertState:

```md
- parent|
  - branch #folded
    - child
```
