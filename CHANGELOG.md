# Changelog

## [0.1.0] - 2026-11-08

Initial release.

- `/meter` cockpit with Overview, Models, Projects, Sessions, and Quotas tabs
- Session scanner for `~/.pi/agent/sessions` with a size+mtime cache and atomic writes
- Cost, token, cache-hit, request, and duration aggregation per provider, model, project, and session
- Quota adapters for OpenCode Go, OpenAI Codex, Claude, and Neuralwatt (read-only credentials)
- `/meter-report`, `/meter-quota`, `/meter-export`, `/meter-widget`, `/meter-status`
- Standalone CLI with text, JSON, and standalone HTML reports
- 27 node:test cases covering parsing, aggregation, quota payloads, and dashboard rendering
