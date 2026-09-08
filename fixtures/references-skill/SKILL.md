---
name: references-skill
description: Explains where client state lives in this app and how stores are shaped. Use when adding or changing a Zustand store.
---

# Client state

State lives in small Zustand stores, one per concern. The store shape and the
selector conventions are documented in `references/stores.md`; read it before
adding a store so new ones match the existing ones.

## Rules

- One store per concern, never a single app-wide store.
- Components subscribe through selectors, not to the whole store.
