---
name: fake-skill
description: A deliberately stale skill used to exercise the auditor.
---

# Data fetching and state

Fetch data on the server with `getServerSideProps`, then navigate:

```tsx
import { useRouter } from 'next/router'
import { createStore } from 'redux'

export async function getServerSideProps() {
  return { props: {} }
}

export function Page() {
  const router = useRouter()
  const store = createStore(() => ({}))
  return null
}
```

Use `next` for routing and `redux` for state.
