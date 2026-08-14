# Contributing

## Before changing the foundation

Read `README.md`, `docs/REPOSITORY-BOUNDARIES.md`, the relevant packet report,
and the ADRs that govern the area. Keep changes within one packet or amendment
boundary and state explicitly what remains out of scope.

The accepted 1.0.0 and 1.1.0 schema bytes are frozen. Additive successor work
must use a new compatible namespace/version and corresponding tests. Never
regenerate or reformat a frozen artifact.

## Development

Requirements:

- Node.js 22.16 or newer
- npm
- a `tar` implementation that can extract ZIP files
- the exact v0.4.0 reference-node release asset outside the repository

Install and verify:

```powershell
npm ci
$env:CERBANIMO_REFERENCE_ARCHIVE = "C:\path\to\Cerbanimo-Constellary-Reference-Node-v0.4.0.zip"
npm test
npm run verify:publication
```

The test suite verifies the archive SHA-256 before executing it. Do not weaken
or bypass that check.

## Pull requests

- Use a focused branch and a concise, intentional commit.
- Link the governing ADR or add one when a durable architecture/product
  decision changes.
- Describe contract/schema compatibility and security implications.
- Include the exact test commands and results.
- Keep the PR in draft while required evidence gates or human decisions remain.
- Do not merge generated output, runtime state, or a release asset into Git.

Before pushing, review both `git diff` and `git diff --staged`. The ignore file
and publication-boundary script are guardrails, not authorization to publish
unknown local content.

## Test data

Fixtures must be deterministic and synthetic. Do not use copied production
records, personal identifiers, actual evidence, real credentials, or local
identity exports. Generate ephemeral cryptographic keys during the test process
and never serialize private key material into fixtures or logs.
