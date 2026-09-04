---
name: procedural-skill
description: A command-line workflow skill that mentions packages only in prose and shell. Use when running the project's test CLI or documenting how to invoke it.
---

# Run the test CLI

This project runs its tests from the shell, not from imported library APIs.
Reach for this skill when the user asks how to run tests, not when they ask
you to write a test file.

```bash
npx vitest run --reporter=verbose
ROOT=$(git rev-parse --show-toplevel)
npx vitest run "$ROOT"
```

The project uses `vitest` as a CLI. Do not invent `import { describe } from 'vitest'`
examples unless you are editing an existing test file.
