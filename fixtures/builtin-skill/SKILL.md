---
name: builtin-skill
description: A skill whose code examples only use Node builtins and path aliases, so it references no npm packages at all.
---

# Reading config files in this project

Configuration lives on disk and is read at startup. The helper below loads a
JSON config relative to the project root, which keeps the call sites free of
path juggling and makes the loader easy to unit test in isolation.

```ts
import { readFileSync } from 'node:fs'
import { join } from 'path'

export function loadConfig(root: string) {
  return JSON.parse(readFileSync(join(root, 'config.json'), 'utf-8'))
}
```

## Importing internal modules

Internal modules are reached through the `@/` alias configured in tsconfig and
the `#internal` subpath imports declared in package.json. Neither is an npm
package, so neither belongs in a dependency discussion.

```ts
import { Button } from '@/components/Button'
import { logger } from '#internal/logger'
import { theme } from '~/styles/theme'

export function Panel() {
  logger.debug(theme.name)
  return Button
}
```
