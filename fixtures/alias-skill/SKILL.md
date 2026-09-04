---
name: alias-skill
description: A well-aligned skill that renames its imports with `as`. Used to check that verification compares the exported names, not the local aliases.
---

# Navigation and state with renamed imports

This project navigates with the Next.js App Router and keeps client state in
a zustand store, exactly as `src/app.tsx` does. The examples below rename the
imports locally, which must not change how they are verified against the repo.

## Routing

Read the router inside the component body and prefer declarative links when
a plain anchor navigation is enough; the imperative router is for redirects.

```tsx
import { useRouter as useNav } from 'next/navigation'

export function BackButton() {
  const nav = useNav()
  return <button onClick={() => nav.back()}>Back</button>
}
```

## State

Create stores with zustand's `create` and subscribe with selector functions so
components only re-render when the slice they read actually changes.

```tsx
import { create as makeStore } from 'zustand'

const useCounter = makeStore<{ count: number }>(() => ({ count: 0 }))

export function Counter() {
  const count = useCounter(s => s.count)
  return <span>{count}</span>
}
```
