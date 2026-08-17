import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  frontmatterList,
  frontmatterString,
  parseFrontmatter,
  parseSimpleYaml,
} from '../dist/frontmatter.js'

describe('parseFrontmatter', () => {
  test('separates frontmatter from body', () => {
    const { data, body, hasFrontmatter } = parseFrontmatter(
      '---\nname: demo\n---\n# Heading\n\nProse.\n',
    )
    assert.equal(hasFrontmatter, true)
    assert.equal(data.name, 'demo')
    assert.equal(body, '# Heading\n\nProse.\n')
  })

  test('treats a file without a fence as all body', () => {
    const { data, body, hasFrontmatter } = parseFrontmatter('# Heading\n')
    assert.equal(hasFrontmatter, false)
    assert.deepEqual(data, {})
    assert.equal(body, '# Heading\n')
  })

  test('ignores an unterminated fence', () => {
    const { hasFrontmatter } = parseFrontmatter('---\nname: demo\n# Heading\n')
    assert.equal(hasFrontmatter, false)
  })

  test('does not read keys that appear only in the body', () => {
    const { data } = parseFrontmatter(
      '---\nname: real\n---\n\n```yaml\nname: example-from-a-code-block\n```\n',
    )
    assert.equal(data.name, 'real')
  })

  test('reads keys from a body-only document as nothing', () => {
    const { data } = parseFrontmatter('# Heading\n\nname: not-frontmatter\n')
    assert.equal(frontmatterString(data, 'name'), undefined)
  })

  test('normalizes CRLF input', () => {
    const { data } = parseFrontmatter('---\r\nname: demo\r\n---\r\nBody\r\n')
    assert.equal(data.name, 'demo')
  })
})

describe('parseSimpleYaml', () => {
  test('reads block lists', () => {
    const data = parseSimpleYaml('categories:\n  - seo\n  - accessibility\n')
    assert.deepEqual(data.categories, ['seo', 'accessibility'])
  })

  test('reads inline lists', () => {
    const data = parseSimpleYaml('categories: [seo, "accessibility", \'i18n\']\n')
    assert.deepEqual(data.categories, ['seo', 'accessibility', 'i18n'])
  })

  test('reads unindented block lists', () => {
    const data = parseSimpleYaml("packages:\n- 'apps/*'\n- 'libs/*'\n")
    assert.deepEqual(data.packages, ['apps/*', 'libs/*'])
  })

  test('strips quotes and escapes', () => {
    const data = parseSimpleYaml('a: "quoted"\nb: \'single\'\nc: "say \\"hi\\""\n')
    assert.equal(data.a, 'quoted')
    assert.equal(data.b, 'single')
    assert.equal(data.c, 'say "hi"')
  })

  test('drops comments but keeps hashes inside values', () => {
    const data = parseSimpleYaml(
      '# leading comment\nname: demo # trailing\ncolor: "#ff0000"\nurl: https://example.com/#anchor\n',
    )
    assert.equal(data.name, 'demo')
    assert.equal(data.color, '#ff0000')
    assert.equal(data.url, 'https://example.com/#anchor')
  })

  test('reads block scalars', () => {
    const literal = parseSimpleYaml('description: |\n  line one\n  line two\nname: x\n')
    assert.equal(literal.description, 'line one\nline two')
    assert.equal(literal.name, 'x')

    const folded = parseSimpleYaml('description: >\n  line one\n  line two\n')
    assert.equal(folded.description, 'line one line two')
  })

  test('skips nested mappings without consuming the next key', () => {
    const data = parseSimpleYaml('metadata:\n  nested: value\nname: demo\n')
    assert.equal(data.name, 'demo')
  })

  test('returns nothing for an empty document', () => {
    assert.deepEqual(parseSimpleYaml(''), {})
  })
})

describe('accessors', () => {
  test('frontmatterList tolerates the scalar shorthand', () => {
    assert.deepEqual(frontmatterList({ categories: 'seo' }, 'categories'), ['seo'])
    assert.deepEqual(frontmatterList({ categories: ['a', 'b'] }, 'categories'), [
      'a',
      'b',
    ])
    assert.deepEqual(frontmatterList({}, 'categories'), [])
  })

  test('frontmatterString rejects lists and empty values', () => {
    assert.equal(frontmatterString({ name: 'demo' }, 'name'), 'demo')
    assert.equal(frontmatterString({ name: [] }, 'name'), undefined)
    assert.equal(frontmatterString({ name: '' }, 'name'), undefined)
  })
})
