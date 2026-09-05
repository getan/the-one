<div align="center">
  <img src="./app_icon.png" alt="The One" width="96" />

  <h1>The One</h1>

  <p>
    <strong>A web-deployable multi-agent management and orchestration tool — one container per engineer, next to code-server.</strong>
  </p>

  <p>
    <a href="./README.md">简体中文（完整方案）</a>
    |
    <strong>English</strong>
  </p>

  <p>
    <a href="https://the-zeroth.com">The Zeroth site (concept reference)</a>
    |
    <a href="https://github.com/getan/the-one">This repo</a>
  </p>
</div>

---

## Background

We run AI cloud dev spaces: many podman containers on one ECS host, one container per engineer, accessed from Mac browsers through a unified entry (Caddy + shared auth). code-server is already baked into the shared image, one per person.

This project adds a second web service in the same delivery shape: multi-agent management and orchestration, one per container, behind the same Caddy. Phase one supports Codex only; develop on Mac and trial in a local browser first. Full plan in Chinese: [`README.md`](./README.md).

## Plan in brief

- **Shell: Orca (open-source MIT, real implementation).** Sessions, parallel agents, workspace isolation, log/terminal streaming. It already ships a web entry (`dev:web / build:web`, `src/renderer/web-index.html` → `out/web`, built for reverse-proxy subpaths).
- **Soul: The One by The Zeroth (closed-source, concepts only).** Graph blueprints (nodes bind agent presets, edges are handoff instructions), a router agent spawning subgraphs, god-view observability, teams saved as reusable genes.
- **Open-source pieces.** `LangGraph.js` as the runtime (TS stack, nodes + edges + state + checkpoints); handoff semantics after the OpenAI Agents SDK; blueprint-as-gene file format inspired by `agent-blueprint` (single-YAML + lint/test/trace discipline).
- **DAG vs parallel.** The One's Graph is a collaboration DAG (relay race, nestable via `create_subgraph`); Orca's parallel mode is a race pool (one prompt fanned out to N isolated worktrees, human merges the winner). Unifier: Orca fan-out = The One's Division; DAG for collaboration flow, parallel pools inside nodes, edges define handoff and acceptance only.

## Deployment: like code-server

```text
ECS host (root owned by us)
├── podman container A (teammate A): code-server :8080 + agent-board :8081 + data volume
├── podman container B (teammate B): code-server :8080 + agent-board :8081 + data volume
        ↑
   Caddy per-user routing + unified auth (exists; localhost:8081 for local trials)
```

Single port, no database: the Node service serves the static UI on the same port, state on a file volume. Guardrails: no unbounded proliferation on shared ECS, per-container budgets, one-click teardown, audit log first.

## Three changes to Orca Web

Orca Web exists but is a remote-control client (browser shell, execution stays on the host, pairing-based). We change: (1) auth — pairing codes become Caddy auth with per-container auto-connect; (2) runtime — host side (`orcad`/remote execution) packed in the container, Codex only with folder-level isolation first; (3) feature — a first-class `Graphs` view (blueprint list, canvas read-only first, handoff text, run timeline), Electron-only pieces replaced with web implementations (xterm.js, HTTP/SSE).

## Phases

- **P0 (Mac local):** Codex only, folder isolation, spawn/observe/kill, log polling.
- **P1 (into the image):** single port + volume + Caddy snippet next to code-server, auth via Caddy.
- **P2 (The One lite):** handoff edges, template versioning, `.zerospace`-style import/export; then worktree isolation and more backends.

## Docs area (kept from the-zeroth-docs)

Canonical docs live under `content/docs/en` and `content/docs/zh` with identical slugs for language switching without route drift (app guide, settings, single-agent → multi-agent evolution, release notes). Drafts in local `docs_md` (git-ignored); images/videos under `public/docs-assets`; regenerate via `python scripts\migrate_docs_md.py`. Treat docs as concept/acceptance reference, not as implementation protocol.

## Maintenance

- Keep en/zh slugs identical; user-facing prose in `content/docs`, raw drafts in local `docs_md`; screenshots/videos only via `public/docs-assets`.
- Product code goes under `apps/`; never commit secrets, accounts, or private infrastructure.
- Remotes: `origin` = `https://github.com/getan/the-one.git` (this project), `upstream` = original docs upstream (read-only concept sync).
