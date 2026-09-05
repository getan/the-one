# agent-board

Web multi-agent board, phase zero. One port serves the UI and the JSON API.
Sessions spawn `codex exec`; blueprints describe handoff chains and fanouts.

## Run

```sh
npm start
```

Environment: `AGENT_BOARD_HOST` (default 127.0.0.1), `AGENT_BOARD_PORT`
(default 8081), `AGENT_BOARD_DATA` (default ./data), `AGENT_BOARD_TEMPLATES`
(default ./templates), `AGENT_BOARD_CODEX` (default codex),
`AGENT_BOARD_WORKDIR` (default .), `AGENT_BOARD_MOCK=1` forces the mock
runner with scripted log lines. Without the flag the server uses the real
Codex CLI when the binary works, otherwise it also falls back to mock and
reports the active mode on `/health`.

## API

- `GET /health` — liveness plus runner mode.
- `GET /api/sessions` — list, newest first.
- `POST /api/sessions` `{prompt, workdir?, preset?}` — create and start,
  prepending the preset system prompt when given.
- `GET /api/sessions/:id` — one session.
- `POST /api/sessions/:id/kill` — stop a running session.
- `GET /api/sessions/:id/logs?tail=200` — log lines plus truncation flag.
- `GET /api/blueprints` — templates in `templates/`.
- `GET /api/blueprints/:name` — one blueprint.
- `POST /api/blueprints/validate` `{blueprint}` — `{ok, errors}`.
- `POST /api/blueprints/:name/run` `{input?}` — fanout roots run
  concurrently, handoff chains run in order with previous outputs and the
  edge instruction injected; returns `{run}` with session ids.
- `GET /api/runs/:id` — run plus per-node session states.
- `GET /api/runs` — list runs, newest first.
- `GET /api/runs/:id/timeline` — run, per-node session states, and the
  ordered event log (`run.started`, `session.created/finished/killed`,
  `handoff.injected`, `run.finished`).
- `GET /api/presets`, `GET /api/presets/:name` — agent presets from
  `templates/presets/`. Blueprint nodes must reference a known preset;
  the preset system prompt is prepended to the node prompt at run time.

## Isolation

Blueprint node sessions run in `<workdir>/<run>/<node>`, created on launch.
Adhoc sessions keep the requested workdir.

## Spaces: factory defaults plus user copies

`templates/` ships read-only factory blueprints. `POST /api/spaces/import`
stores validated blueprints under `<data>/templates/`; the list merges both
trees with user copies winning (`origin` is `factory` or `space`). Runs
record `blueprintVersion` so a later edit cannot rewrite history.

- `POST /api/spaces/export` `{run?}` — bundle presets, user blueprints,
  and optionally one run with its sessions and events.
- `POST /api/spaces/import` `{bundle}` — validate and store; rejects
  non-bundles and unknown agent presets per blueprint.

## Blueprint format

`templates/<name>.json` with `nodes [{id, agent, prompt}]` and
`edges [{kind: handoff|fanout, from, to, instruction?}]`. Handoff edges
require an instruction and must form a DAG. Blueprints carry a `version`
string recorded on every run.

## Tests and acceptance

```sh
npm test
```

`test/` covers blueprint validation, the mock runner, and the full HTTP
surface against a child-process server on an ephemeral port with temp
dirs. Mac acceptance mirrors the suite with curl: create a session, poll
until `done`, read logs, kill a second session, run `frontend-studio`,
open `/` in a browser.
