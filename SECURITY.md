# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.1.x   | Yes       |
| 1.0.x   | No        |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Report privately via [GitHub Security Advisories](https://github.com/paulgrape/skill-auditor/security/advisories/new) or email **vin.pavel13@gmail.com**. Include steps to reproduce, affected version, and impact if known.

We aim to acknowledge reports within a few business days.

## How this tool handles data

`skill-auditor` is a **local-only CLI**. It reads files on your machine (project source, `package.json`, `SKILL.md`, bundled skill scripts) and writes results to stdout/stderr. It does **not**:

- upload project or skill contents to any service
- call external APIs or fetch remote URLs at runtime
- execute skill scripts or project code

Network use is limited to **you** installing the package (`npm install`, `npx`) or cloning skills via the separate [`skills`](https://github.com/vercel-labs/skills) CLI — not performed by `skill-auditor` commands themselves.

## What this tool is not

`skill-auditor` measures **skill quality and stack alignment** against your repo. It is **not** a security scanner. It does not detect prompt injection, malware, credential leaks, or malicious skill content. Use a dedicated security tool if you need that.

## Scope of audits

Commands scan paths you pass (`--project`, skill roots). Only run it on directories you trust. Parsing uses `ts-morph` and regex over source files; malformed or hostile inputs should fail safely, but treat untrusted repos like any other local analysis tool.
