---
name: aligned-skill
description: A well-aligned skill grounded in the fake project's real stack.
---

# Navigation and state in this project

This project navigates with the Next.js App Router and keeps client state in
a zustand store. Follow the patterns below when adding navigation or state;
they mirror how `src/app.tsx` already works today.

## Routing

Use the App Router hook from `next/navigation` for imperative navigation.
Always read the router inside the component body, never at module scope, and
prefer declarative links when a plain anchor navigation is enough.

```tsx
import { useRouter } from 'next/navigation'

export function BackButton() {
  const router = useRouter()
  return <button onClick={() => router.back()}>Back</button>
}
```

## State

Create stores with zustand's `create` and subscribe with selector functions so
components only re-render when the slice they read actually changes. Keep the
store definition next to the feature that owns it, as the app does today.

```tsx
import { create } from 'zustand'

const useCounter = create<{ count: number }>(() => ({ count: 0 }))

export function Counter() {
  const count = useCounter(s => s.count)
  return <span>{count}</span>
}
```
