<div align="center">

<img src="apps/web/public/logo.png" width="96" alt="ExtSync logo" />

# ExtSync

**Distribute, install and auto-update private Chrome extensions - outside the Chrome Web Store.**

[🌐 extsync.com](https://extsync.com) · [📦 Store](https://extsync.com/store) · [📖 Guide](https://extsync.com/docs) · [🇮🇱 עברית](README.he.md)

![License: source-available](https://img.shields.io/badge/license-source--available-2563EB)
![Web: Next.js 16](https://img.shields.io/badge/web-Next.js%2016-000000)
![API: FastAPI](https://img.shields.io/badge/api-FastAPI-009688)
![Agent: .NET 8 WPF](https://img.shields.io/badge/agent-.NET%208%20WPF-512BD4)
![Releases: Ed25519 signed](https://img.shields.io/badge/releases-Ed25519%20signed-0FB5BA)

</div>

![ExtSync](docs/assets/home.webp)

## What is ExtSync?

ExtSync is a platform to distribute, install, manage and **auto-update private (or unlisted) Chrome Manifest V3 extensions outside the Chrome Web Store** - for private, internal and team extensions.

Every release is **Ed25519-signed** and SHA-256 verified. A small Windows Agent installs the extension once, then keeps it up to date automatically, with auto-rollback on failed updates.

> ExtSync is not a replacement for the Chrome Web Store. The first install of an unpacked extension still requires enabling Developer mode and loading the folder once in `chrome://extensions`. ExtSync makes that one step as simple as possible and then manages every update after it. See [architecture/limitations.md](docs/architecture/limitations.md).

## Highlights

- 🔐 **Signed releases** - Ed25519 over canonical metadata, produced by a network-isolated signing service; the Agent refuses any install without a valid signature and matching SHA-256.
- 🔄 **Automatic updates** - the Agent polls, verifies and applies updates, with auto-rollback and rollout auto-pause on a high failure rate.
- 🧪 **Validation pipeline** - every upload is scanned in an isolated worker (ZIP-slip, path traversal, remote code, manifest mismatch) and scored for risk before it can be published.
- 🌗 **Polished web** - public store plus a developer dashboard; bilingual Hebrew/English, dark by default, SSR + SEO.
- 🛡️ **Security-first** - Argon2id password hashing, JWT with pinned algorithm, refresh-token rotation with theft detection, IDOR-safe authorization, webhook SSRF guard, and a nonce-based CSP.

## Screenshots

| Public store | Developer dashboard |
|---|---|
| [![Store](docs/assets/store.webp)](https://extsync.com/store) | Sign in at [extsync.com](https://extsync.com) |

## Architecture

| Component | Path | Stack | Role |
|---|---|---|---|
| Web | `apps/web` | Next.js + TS | Public site, developer dashboard, install page, admin |
| API | `apps/api` | FastAPI + SQLAlchemy | Source of truth: users, projects, releases, signatures |
| Worker | `apps/worker` | Python | Isolated ZIP analysis, validation, artifact packaging |
| Signing | `apps/api` (`extsync_signing`) | Python | Network-isolated Ed25519 signing service |
| Agent | `apps/agent-windows` | C# / WPF | Windows app that installs and auto-updates extensions |
| Native Host | `apps/native-host` | C# | Native Messaging bridge between Chrome and the Agent |
| Bridge | `packages/extension-bridge` | TypeScript | In-extension package for verified reload |
| CLI | `apps/cli` | Node / TS | `extsync` - init / validate / pack / upload / publish |
| Schema | `packages/release-schema` | JSON Schema + TS/Py | Cross-language source of truth for release metadata |

Deep dives: [architecture overview](docs/architecture/overview.md) · [decision records](docs/architecture/adr) · [signing](docs/security/signing.md) · [end-to-end flow](docs/developer-guide/end-to-end.md).

## Source-available, not open source

This repository is public so the code can be **read and audited**. ExtSync is a real, hosted product ([extsync.com](https://extsync.com)) - not a self-host kit - and the code is **not** licensed for reuse or production hosting. See [LICENSE](LICENSE).

Building locally to review the code: [developer-guide/getting-started.md](docs/developer-guide/getting-started.md).

## Contact

Built by Avraham Glasser - <glasser.avraham@gmail.com>
