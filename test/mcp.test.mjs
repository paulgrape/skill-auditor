import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { FAKE_PROJECT, runMcp } from './helpers.mjs'

const MODERN_VERSION = '2026-07-28'
const LEGACY_VERSION = '2025-06-18'

/** Per-request metadata every modern (2026-07-28 and later) request carries. */
function modernMeta(protocolVersion = MODERN_VERSION) {
  return {
    _meta: {
      'io.modelcontextprotocol/protocolVersion': protocolVersion,
      'io.modelcontextprotocol/clientCapabilities': {},
      'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0.0.0' },
    },
  }
}

function request(id, method, params = {}) {
  return { jsonrpc: '2.0', id, method, params }
}

function byId(responses, id) {
  return responses.find(response => response.id === id)
}

describe('mcp server', () => {
  describe('handshake', () => {
    let responses

    before(async () => {
      ;({ responses } = await runMcp([
        request(1, 'server/discover', modernMeta()),
        request(2, 'initialize', {
          protocolVersion: LEGACY_VERSION,
          capabilities: {},
          clientInfo: { name: 'test', version: '0.0.0' },
        }),
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        request(3, 'tools/list'),
        request(4, 'nonsense/method'),
      ]))
    })

    test('advertises its protocol versions and tools capability', () => {
      const discover = byId(responses, 1).result
      assert.ok(discover.supportedVersions.includes(MODERN_VERSION))
      assert.ok(discover.supportedVersions.includes(LEGACY_VERSION))
      assert.deepEqual(discover.capabilities, {
        tools: {},
        resources: {},
        prompts: {},
      })
      assert.equal(discover.resultType, 'complete')
    })

    test('still answers the legacy initialize handshake', () => {
      const initialized = byId(responses, 2).result
      assert.equal(initialized.protocolVersion, LEGACY_VERSION)
      assert.equal(initialized.serverInfo.name, 'skill-auditor')
    })

    test('answers no notification', () => {
      assert.equal(
        responses.filter(response => response.id === undefined).length,
        0,
      )
    })

    test('lists the analysis tools with input schemas', () => {
      const { tools } = byId(responses, 3).result
      assert.deepEqual(
        tools.map(tool => tool.name).sort(),
        [
          'audit',
          'docs',
          'extract',
          'gaps',
          'scaffold',
          'scan',
          'spec-check',
          'validate',
        ],
      )
      for (const tool of tools) {
        assert.equal(tool.inputSchema.type, 'object')
        assert.ok(tool.description.length > 0)
        const readOnly = tool.name !== 'scaffold'
        assert.equal(tool.annotations.readOnlyHint, readOnly, tool.name)
      }
      const audit = tools.find(tool => tool.name === 'audit')
      assert.deepEqual(audit.inputSchema.required, ['path'])
    })

    test('rejects an unknown method rather than answering it', () => {
      assert.equal(byId(responses, 4).error.code, -32601)
    })
  })

  describe('protocol version negotiation', () => {
    let responses

    before(async () => {
      ;({ responses } = await runMcp([
        request(1, 'tools/list', modernMeta('1900-01-01')),
        request(2, 'tools/list', {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
          },
        }),
      ]))
    })

    test('reports the versions it supports for an unknown one', () => {
      const { error } = byId(responses, 1)
      assert.equal(error.code, -32022)
      assert.equal(error.data.requested, '1900-01-01')
      assert.ok(error.data.supported.includes(MODERN_VERSION))
    })

    test('rejects a modern request that omits client capabilities', () => {
      assert.equal(byId(responses, 2).error.code, -32602)
    })
  })

  describe('tools/call', () => {
    let responses

    before(async () => {
      ;({ responses } = await runMcp([
        request(1, 'tools/call', {
          name: 'scan',
          arguments: { project: FAKE_PROJECT },
          ...modernMeta(),
        }),
        request(2, 'tools/call', {
          name: 'audit',
          arguments: {
            path: './fixtures/aligned-skill',
            project: FAKE_PROJECT,
          },
        }),
        request(3, 'tools/call', {
          name: 'gaps',
          arguments: {
            roots: ['./fixtures/nested-skills'],
            project: FAKE_PROJECT,
            checklist: 'frontend',
          },
        }),
        request(4, 'tools/call', {
          name: 'audit',
          arguments: { path: './fixtures/does-not-exist' },
        }),
        request(5, 'tools/call', { name: 'no-such-tool', arguments: {} }),
      ]))
    })

    test('scan returns the project ground truth as structured content', () => {
      const { structuredContent, content, isError } = byId(responses, 1).result
      assert.equal(isError, false)
      assert.equal(structuredContent.schemaVersion, 1)
      assert.ok(structuredContent.usedImports.next.includes('next/navigation'))
      assert.deepEqual(JSON.parse(content[0].text), structuredContent)
    })

    test('audit returns the same envelope as the CLI', () => {
      const { structuredContent } = byId(responses, 2).result
      assert.equal(structuredContent.count, 1)
      assert.ok(structuredContent.results[0].score.overall >= 85)
    })

    test('gaps reports checklist coverage', () => {
      const { structuredContent } = byId(responses, 3).result
      assert.ok(structuredContent.coveredCategories.includes('routing'))
      assert.ok(structuredContent.gaps.some(gap => gap.kind === 'checklist-gap'))
    })

    test('reports a bad path as a tool error the model can act on', () => {
      const { isError, content } = byId(responses, 4).result
      assert.equal(isError, true)
      assert.match(content[0].text, /does-not-exist/)
    })

    test('rejects an unknown tool as invalid params', () => {
      assert.equal(byId(responses, 5).error.code, -32602)
    })
  })

  describe('resources and prompts', () => {
    let responses

    before(async () => {
      ;({ responses } = await runMcp([
        request(1, 'resources/list'),
        request(2, 'resources/read', {
          uri: 'skill-auditor://templates/website-accessibility',
        }),
        request(3, 'prompts/list'),
        request(4, 'prompts/get', {
          name: 'audit-and-fix',
          arguments: { skillsRoot: '.cursor/skills', project: '.' },
        }),
        request(5, 'tools/call', {
          name: 'validate',
          arguments: { path: './fixtures/aligned-skill' },
        }),
      ]))
    })

    test('lists bundled templates as markdown resources', () => {
      const { resources } = byId(responses, 1).result
      assert.ok(
        resources.some(r => r.uri === 'skill-auditor://templates/website-accessibility'),
      )
      assert.ok(
        resources.some(r => r.uri === 'skill-auditor://bundled/skill-auditor'),
      )
    })

    test('reads a template SKILL.md', () => {
      const { contents } = byId(responses, 2).result
      assert.match(contents[0].text, /name: website-accessibility/)
    })

    test('exposes the audit-and-fix prompt', () => {
      const { prompts } = byId(responses, 3).result
      assert.equal(prompts[0].name, 'audit-and-fix')
      const got = byId(responses, 4).result
      assert.match(got.messages[0].content.text, /scan/)
      assert.match(got.messages[0].content.text, /\.cursor\/skills/)
    })

    test('validate returns the spec-lint envelope', () => {
      const { structuredContent } = byId(responses, 5).result
      assert.equal(structuredContent.valid, true)
      assert.equal(structuredContent.count, 1)
    })
  })

  test('writes nothing but protocol messages, and exits with stdin', async () => {
    const { responses, status } = await runMcp([
      request(1, 'ping'),
      'not json at all',
    ])
    assert.equal(status, 0)
    assert.equal(byId(responses, 1).result.resultType, 'complete')
    assert.equal(responses.at(-1).error.code, -32700)
  })
})
