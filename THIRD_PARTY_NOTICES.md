# Third-party notices

pi-meter is MIT-licensed. It re-implements provider usage endpoints in TypeScript; no source code from the projects below is copied into this repository.

## CodexBar

- Project: https://github.com/steipete/CodexBar
- License: MIT
- Used for: endpoint URLs, request headers, and response field names for the OpenCode Go, OpenAI Codex, Claude OAuth, and Neuralwatt quota providers, and for the general idea of a per-provider usage cockpit. The provider documentation under CodexBar's `docs/` directory was the reference for those request shapes.

## pi

- Project: https://github.com/earendil-works/pi
- License: MIT
- Used as: the host application and the source of the session transcript format, extension API, and TUI component library (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`).
