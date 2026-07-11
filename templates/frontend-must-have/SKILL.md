---
name: frontend-must-have
description: Must-have checklist for a modern React/Next.js frontend project.
---

# Frontend must-have checklist

Use this skill when bootstrapping or auditing a frontend project. Match the stack the repo actually uses.

## Routing (Next.js App Router)

```tsx
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export function Nav() {
  const router = useRouter()
  return <Link href="/dashboard">Dashboard</Link>
}
```

## State management

```tsx
import { create } from 'zustand'

const useStore = create<{ count: number }>(() => ({ count: 0 }))
```

## Data fetching

```tsx
import { useQuery } from '@tanstack/react-query'

export function UserList() {
  const { data } = useQuery({ queryKey: ['users'], queryFn: fetchUsers })
  return null
}
```

## Validation

```tsx
import { z } from 'zod'

const UserSchema = z.object({ email: z.string().email() })
```

## Styling

Use `tailwindcss` utility classes. Keep component styles colocated.

## Testing

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
```

- Write unit tests with `vitest` and `@testing-library/react`.
- Add E2E with `playwright` for critical user flows.
