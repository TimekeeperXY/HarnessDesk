# Contributing to HarnessDesk

Thank you for helping improve HarnessDesk. This is an independent community project and is not maintained or endorsed by DeepSeek.

## Development setup

Requirements:

- Node.js 22.19 or newer
- pnpm 10.33
- Windows or macOS for desktop integration testing

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

Keep changes focused and include tests for behavior that can regress. Do not commit API keys, credentials, logs, generated runtime directories, model weights, installers, or user data.

Harness compatibility is intentionally version-locked. A Harness dependency upgrade must update the lockfile, runtime patch compatibility checks, smoke tests, and release notes together.

By submitting a contribution, you agree that it may be distributed under the repository's MIT License.
