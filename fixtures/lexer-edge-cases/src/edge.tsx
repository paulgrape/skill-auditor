// import 'commented-out-line' must not count
/* import 'commented-out-block'
   import { nope } from 'nope' */
import React, { useState, type FC } from 'react'
import type { ZodSchema } from 'zod'
import * as Query from '@tanstack/react-query'
import { debounce as delay, throttle } from 'lodash-es'
import 'side-effect-only'
export { default as Chalk } from 'chalk'
export * from 'next/navigation'

const looksLikeImport = "import { fake } from 'string-import'"
const template = `import x from 'template-import' ${'nested'} require('template-require')`
const divider = /import\s+'regex-import'/g
const notDivision = 10 / 2 / 1
const url = 'https://example.com/import/from/url'

const dayjs = require('dayjs')
const { default: clsx } = require("clsx")
const lazy = () => import('./local/module')
const dynamic = async () => (await import('next/dynamic')).default

export const Component: FC = () => {
  const [count] = useState(0)
  const client = new Query.QueryClient()
  const schema: ZodSchema | null = null
  return (
    <div title="import 'jsx-attribute'" className={clsx('a')}>
      {`import 'jsx-template'`} {String(count)} {String(schema)} {String(client)}
      {delay(() => throttle(() => dayjs()), 1)} {looksLikeImport} {template}
      {String(divider)} {notDivision} {url} {String(lazy)} {String(dynamic)}
      {React.version}
    </div>
  )
}
