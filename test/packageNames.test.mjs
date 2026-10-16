import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { isPackageSpecifier, topLevelPackage } from '../dist/packageNames.js'

describe('isPackageSpecifier', () => {
  test('accepts npm specifiers', () => {
    for (const specifier of [
      'next',
      'next/navigation',
      '@tanstack/react-query',
      '@tanstack/react-query/build/modern',
      'react-hook-form',
    ]) {
      assert.equal(isPackageSpecifier(specifier), true, specifier)
    }
  })

  test('rejects relative and absolute paths', () => {
    for (const specifier of ['./local', '../up', '/abs/path', '']) {
      assert.equal(isPackageSpecifier(specifier), false, specifier)
    }
  })

  test('rejects node builtins in both spellings', () => {
    for (const specifier of ['node:fs', 'node:path', 'fs', 'path', 'crypto']) {
      assert.equal(isPackageSpecifier(specifier), false, specifier)
    }
  })

  test('rejects path aliases and subpath imports', () => {
    for (const specifier of [
      '@/components/Button',
      '~/styles/theme',
      '~utils',
      '#internal/logger',
    ]) {
      assert.equal(isPackageSpecifier(specifier), false, specifier)
    }
  })
})

describe('topLevelPackage', () => {
  test('reduces a specifier to its package name', () => {
    assert.equal(topLevelPackage('next/navigation'), 'next')
    assert.equal(topLevelPackage('zustand'), 'zustand')
    assert.equal(
      topLevelPackage('@tanstack/react-query/build'),
      '@tanstack/react-query',
    )
  })

  test('returns an empty string for non-packages', () => {
    for (const specifier of ['node:fs', 'fs', '@/x/y', './local', '#internal']) {
      assert.equal(topLevelPackage(specifier), '', specifier)
    }
  })

  test('strips npm: and jsr: registry prefixes and embedded version ranges', () => {
    assert.equal(topLevelPackage('npm:zod'), 'zod')
    assert.equal(topLevelPackage('npm:zod@^3.22.0'), 'zod')
    assert.equal(topLevelPackage('npm:zod@^3.22.0/lib'), 'zod')
    assert.equal(
      topLevelPackage('npm:@tanstack/react-query@^5.0.0/devtools'),
      '@tanstack/react-query',
    )
    assert.equal(topLevelPackage('jsr:@std/path@^1.0.0/posix'), '@std/path')
    assert.equal(isPackageSpecifier('npm:zod@^3.22.0'), true)
    assert.equal(isPackageSpecifier('jsr:@std/path@^1.0.0'), true)
  })
})
