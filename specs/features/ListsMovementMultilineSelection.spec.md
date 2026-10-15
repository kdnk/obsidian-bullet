# move-list-item-up should keep each selection endpoint on its original item

- applyState:

```md
- item 1
- |item 2
- ite|m 3
```

- execute: `bullet:move-list-item-up`
- assertState:

```md
- item 1
- ite|m 3
- |item 2
```

# move-list-item-down should keep an endpoint before the moved item in place

- applyState:

```md
- |item 1
- ite|m 2
- item 3
```

- execute: `bullet:move-list-item-down`
- assertState:

```md
- |item 1
- item 3
- ite|m 2
```
