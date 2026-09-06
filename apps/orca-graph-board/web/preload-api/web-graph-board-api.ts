export type GraphBoardSessionStatus = 'running' | 'done' | 'failed' | 'killed'

export interface GraphBoardSession {
  id: string
  prompt: string
  workdir: string
  blueprint: string | null
  node: string | null
  run: string | null
  status: GraphBoardSessionStatus
  pid: number | null
  exitCode: number | null
  createdAt: string
  finishedAt: string | null
}

export interface GraphBoardNode {
  id: string
  agent: string
  prompt: string
}

export interface GraphBoardEdge {
  kind: 'handoff' | 'fanout'
  from: string
  to: string
  instruction?: string
}

export interface GraphBoardBlueprint {
  name: string
  description?: string
  version?: string | null
  nodes: GraphBoardNode[]
  edges: GraphBoardEdge[]
}

export interface GraphBoardBlueprintSummary {
  name: string
  version: string | null
  nodes: number
  edges: number
  origin: 'factory' | 'space'
}

export interface GraphBoardRun {
  id: string
  blueprint: string
  blueprintVersion: string | null
  createdAt: string
  sessions: string[]
}

export interface GraphBoardEvent {
  ts: string
  type: string
  run?: string | null
  session?: string | null
  node?: string | null
  blueprint?: string | null
  from?: string
  instruction?: string
  exitCode?: number | null
}

export interface GraphBoardPreset {
  name: string
  description: string
  systemPrompt: string
}

export type GraphBoardError =
  | { kind: 'http'; status: number; detail: string }
  | { kind: 'network'; message: string }
  | { kind: 'payload'; message: string }

export const GRAPH_BOARD_DEFAULT_PATH = '/board/'
const BOARD_OVERRIDE_PARAM = 'board'

function joinBase(candidate: string): string | null {
  const trimmed = candidate.trim()
  if (!/^https?:\/\//i.test(trimmed)) {
    return null
  }
  return trimmed.endsWith('/') ? trimmed : trimmed + '/'
}

export function resolveGraphBoardBaseUrl(args: {
  origin: string
  search?: string
  storedOverride?: string | null
}): string {
  if (args.search) {
    const params = new URLSearchParams(args.search.startsWith('?') ? args.search : '?' + args.search)
    const fromQuery = params.get(BOARD_OVERRIDE_PARAM)
    if (fromQuery) {
      const joined = joinBase(fromQuery)
      if (joined) {
        return joined
      }
    }
  }
  if (args.storedOverride) {
    const joined = joinBase(args.storedOverride)
    if (joined) {
      return joined
    }
  }
  return args.origin.replace(/\/$/, '') + GRAPH_BOARD_DEFAULT_PATH
}

export function summarizeRunStates(
  sessions: Pick<GraphBoardSession, 'node' | 'id' | 'status'>[]
): { node: string; status: GraphBoardSessionStatus }[] {
  return sessions.map((session) => ({
    node: session.node ?? session.id,
    status: session.status
  }))
}

type FetchImpl = (input: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

export interface GraphBoardClient {
  health: () => Promise<{ ok: boolean; mode: string }>
  listSessions: () => Promise<GraphBoardSession[]>
  createSession: (input: { prompt: string; workdir?: string; preset?: string }) => Promise<GraphBoardSession>
  killSession: (id: string) => Promise<GraphBoardSession>
  sessionLogs: (id: string, tail?: number) => Promise<{ session: GraphBoardSession; lines: string[]; truncated: boolean }>
  listBlueprints: () => Promise<GraphBoardBlueprintSummary[]>
  getBlueprint: (name: string) => Promise<GraphBoardBlueprint>
  saveBlueprint: (blueprint: GraphBoardBlueprint) => Promise<GraphBoardBlueprint>
  deleteBlueprint: (name: string) => Promise<{ ok: boolean }>
  validateBlueprint: (blueprint: GraphBoardBlueprint) => Promise<{ ok: boolean; errors: string[] }>
  runBlueprint: (name: string, input?: string) => Promise<GraphBoardRun>
  getRun: (id: string) => Promise<GraphBoardRun & { sessions: GraphBoardSession[] }>
  runTimeline: (id: string) => Promise<{ run: GraphBoardRun & { sessions: GraphBoardSession[] }; events: GraphBoardEvent[] }>
  listRuns: () => Promise<GraphBoardRun[]>
  listPresets: () => Promise<GraphBoardPreset[]>
  exportSpace: (runId?: string) => Promise<{ bundle: unknown }>
  importSpace: (bundle: unknown) => Promise<{ ok: boolean; imported: string[]; errors: unknown[] }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function createGraphBoardClient(args: {
  baseUrl: string
  fetchImpl?: FetchImpl
}): GraphBoardClient {
  const base = args.baseUrl.endsWith('/') ? args.baseUrl : args.baseUrl + '/'
  const fetchJson = async <Result>(path: string, init?: Record<string, unknown>): Promise<Result> => {
    const runFetch: FetchImpl =
      args.fetchImpl ??
      ((globalThis as unknown as { fetch: FetchImpl }).fetch.bind(globalThis) as FetchImpl)
    let response
    try {
      response = await runFetch(base + path, {
        headers: { 'content-type': 'application/json' },
        ...(init ?? {})
      })
    } catch (error) {
      throw { kind: 'network', message: error instanceof Error ? error.message : String(error) } as GraphBoardError
    }
    if (!response.ok) {
      throw { kind: 'http', status: response.status, detail: await response.text() } as GraphBoardError
    }
    const payload = (await response.json()) as unknown
    if (!isRecord(payload)) {
      throw { kind: 'payload', message: 'expected a JSON object from ' + path } as GraphBoardError
    }
    return payload as unknown as Result
  }
  const unwrap = <Item>(payload: { session?: Item }) => {
    if (!payload.session) {
      throw { kind: 'payload', message: 'missing session in response' } as GraphBoardError
    }
    return payload.session
  }
  return {
    health: () => fetchJson<{ ok: boolean; mode: string }>('health'),
    listSessions: async () => (await fetchJson<{ sessions: GraphBoardSession[] }>('api/sessions')).sessions,
    createSession: async (input) =>
      unwrap(await fetchJson<{ session: GraphBoardSession }>('api/sessions', { method: 'POST', body: JSON.stringify(input) })),
    killSession: async (id) =>
      unwrap(
        (
          await fetchJson<{ session: GraphBoardSession }>(
            'api/sessions/' + encodeURIComponent(id) + '/kill',
            { method: 'POST' }
          )
        )
      ),
    sessionLogs: (id, tail = 200) =>
      fetchJson<{ session: GraphBoardSession; lines: string[]; truncated: boolean }>(
        'api/sessions/' + encodeURIComponent(id) + '/logs?tail=' + tail
      ),
    listBlueprints: async () => (await fetchJson<{ blueprints: GraphBoardBlueprintSummary[] }>('api/blueprints')).blueprints,
    getBlueprint: async (name) =>
      (await fetchJson<{ blueprint: GraphBoardBlueprint }>('api/blueprints/' + encodeURIComponent(name))).blueprint,
    saveBlueprint: async (blueprint) =>
      (await fetchJson<{ blueprint: GraphBoardBlueprint }>('api/blueprints/' + encodeURIComponent(blueprint.name), { method: 'PUT', body: JSON.stringify(blueprint) })).blueprint,
    deleteBlueprint: async (name) =>
      await fetchJson<{ ok: boolean }>('api/blueprints/' + encodeURIComponent(name), { method: 'DELETE' }),
    validateBlueprint: async (blueprint) =>
      await fetchJson<{ ok: boolean; errors: string[] }>('api/blueprints/validate', { method: 'POST', body: JSON.stringify({ blueprint }) }),
    runBlueprint: async (name, input = '') =>
      (
        await fetchJson<{ run: GraphBoardRun }>('api/blueprints/' + encodeURIComponent(name) + '/run', {
          method: 'POST',
          body: JSON.stringify({ input })
        })
      ).run,
    getRun: (id) =>
      fetchJson<GraphBoardRun & { sessions: GraphBoardSession[] }>('api/runs/' + encodeURIComponent(id)),
    runTimeline: (id) =>
      fetchJson<{ run: GraphBoardRun & { sessions: GraphBoardSession[] }; events: GraphBoardEvent[] }>(
        'api/runs/' + encodeURIComponent(id) + '/timeline'
      ),
    listRuns: async () => (await fetchJson<{ runs: GraphBoardRun[] }>('api/runs')).runs,
    listPresets: async () => (await fetchJson<{ presets: GraphBoardPreset[] }>('api/presets')).presets,
    exportSpace: async (runId) =>
      await fetchJson<{ bundle: unknown }>('api/spaces/export', { method: 'POST', body: JSON.stringify(runId ? { run: runId } : {}) }),
    importSpace: async (bundle) =>
      await fetchJson<{ ok: boolean; imported: string[]; errors: unknown[] }>('api/spaces/import', { method: 'POST', body: JSON.stringify({ bundle }) })
  }
}
