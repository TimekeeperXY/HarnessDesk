# HarnessDesk

HarnessDesk is a community desktop client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It is not an official DeepSeek product.

[Report a bug](https://github.com/TimekeeperXY/HarnessDesk/issues) · [Contributing guide](CONTRIBUTING.md) · [Security policy](SECURITY.md)

The application runs a pinned Harness build on a private loopback port and presents the official Harness interface in a secured Electron window. Windows and macOS packages carry their own Node.js runtime, so end users do not need Node, pnpm, or a terminal.

## Current compatibility

- Harness: `@deepseek-ai/dsh@0.1.0-rc.6`
- Bundled Node.js: `22.19.0`
- Desktop data: Electron `userData/harness`, isolated from `~/.dsh`
- Network binding: `127.0.0.1` with an operating-system assigned port

The original implementation plan named Harness `0.1.0-rc.5`. That version was present in the upstream source manifest but was never published to npm. HarnessDesk therefore pins the next published build, `0.1.0-rc.6`.

## Pasted images through LM Studio

HarnessDesk can let a text-only Harness model read images through a local LM Studio vision model:

1. Start LM Studio's local server and load a vision-capable model.
2. In HarnessDesk, open **Settings → LM Studio Vision Bridge**.
3. Keep the default local endpoint (`http://127.0.0.1:1234/v1`), select the loaded vision model, test the connection, and save.
4. Restart Harness, then paste an image into the normal conversation box and send it.

If the selected Harness model already supports images, HarnessDesk leaves the prompt untouched and uses Harness's native image path. For text-only models, pasted images are sent to the configured local LM Studio model; its visual observations are inserted into the same turn as untrusted context. The original image is not sent to the remote text model.

The bridge accepts only loopback HTTP endpoints (`127.0.0.1`, `localhost`, or `::1`). Image bytes and generated visual descriptions are not written to HarnessDesk logs. Leaving the model field blank selects the first model reported by LM Studio, so explicitly selecting a known vision model is recommended.

## MiMo voice output

HarnessDesk can read completed Harness answers aloud through Xiaomi MiMo TTS. Open **Settings → MiMo Voice**, enter a MiMo API Key, choose a preset voice, and enable either the speaker button or automatic playback. The default endpoint is `https://api.xiaomimimo.com/v1`; audio requests are sent from the Electron main process to MiMo's OpenAI-compatible chat completions endpoint. The key is stored separately in the application data directory and is never placed in desktop settings, the Harness prompt, or logs.

The preset model is `mimo-v2.5-tts`; its speaker button uses MiMo's PCM16 streaming endpoint so playback can begin while the answer is still being synthesized. MiMo voice design and voice clone model choices are shown for compatibility, while their dedicated style editor and audio-sample picker remain reserved for a later release; those models use the non-streaming fallback.

## System tray

HarnessDesk keeps a system-tray icon while it is running. Closing the main window hides it from the taskbar and leaves the local Harness service and active tasks running. Click the tray icon to restore the window, or use the tray menu to open Harness, open MiMo voice settings, or exit the application.

## Development

This repository contains source code only. Bundled Node.js, the pinned Harness runtime, generated installers, logs, credentials, and user data are intentionally excluded from Git.

```powershell
pnpm install
pnpm dev
```

The development launcher first tries `127.0.0.1:5173`. If Windows reserves or blocks that port, it automatically selects an available local port and passes it to both Vite and Electron. To request a different starting port, set `HARNESSDESK_DEV_PORT` before running `pnpm dev`.

Use `HARNESSDESK_NODE_PATH` to select a development Node executable. Development requires Node.js 22.19 or newer.

## Verification

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Build a self-contained Windows installer:

```powershell
pnpm package:win
```

The runtime preparation step downloads the official Node.js archive, verifies it against Node.js `SHASUMS256.txt`, installs the pinned Harness dependency tree, and produces one compressed, checksummed runtime resource. The Windows installer therefore copies only a small set of files instead of asking NSIS and antivirus software to process tens of thousands of dependencies individually. On first launch HarnessDesk shows extraction progress and caches that runtime by version; later launches reuse it immediately.

## Release status

Generated packages are unsigned test builds. Automatic updates remain disabled until both a signed release feed and platform signing credentials are configured. Windows SmartScreen and macOS Gatekeeper may warn about unsigned artifacts.

## Security notes

- Renderer Node integration is disabled. Context isolation and Chromium sandboxing are enabled.
- Desktop IPC is restricted to the local HarnessDesk shell.
- Harness only binds to `127.0.0.1`; reported URLs are validated before navigation.
- API keys use Harness's `.credentials.yaml` storage and are redacted from desktop logs.
- Harness's file credential provider protects against other operating-system users, but same-user agent processes may still read the file. This is an upstream limitation; an operating-system keychain provider is outside this MVP.

## License

HarnessDesk source is MIT licensed. DeepSeek Harness and bundled third-party components retain their respective licenses and notices.
