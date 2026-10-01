# Store conventions

Every store is created with `create` from Zustand and exports typed hooks.
Selectors keep re-renders scoped to the slice a component reads, so a
counter update does not repaint unrelated views.

```ts
import { create } from 'zustand'

type CounterState = { count: number; increment: () => void }

export const useCounter = create<CounterState>(set => ({
  count: 0,
  increment: () => set(s => ({ count: s.count + 1 })),
}))
```

Read a single field through a selector:

```ts
const count = useCounter(s => s.count)
```
