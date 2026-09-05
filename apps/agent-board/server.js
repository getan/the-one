import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createRunner, codexAvailable } from './runner.js';
import { validateBlueprint, orderHandoffNodes } from './blueprints.js';

const rootDir = join(fileURLToPath(import.meta.url), '..');
const config = {
  host: process.env.AGENT_BOARD_HOST || '127.0.0.1',
  port: Number(process.env.AGENT_BOARD_PORT || 8081),
  dataDir: resolve(rootDir, process.env.AGENT_BOARD_DATA || 'data'),
  templatesDir: resolve(rootDir, process.env.AGENT_BOARD_TEMPLATES || 'templates'),
  presetsDir: resolve(rootDir, process.env.AGENT_BOARD_PRESETS || 'templates/presets'),
  publicDir: resolve(rootDir, 'public'),
  codexBin: process.env.AGENT_BOARD_CODEX || 'codex',
  codexArgs: (process.env.AGENT_BOARD_CODEX_ARGS || '--skip-git-repo-check').split(/\s+/).filter((part) => part.length > 0),
  workdir: resolve(rootDir, process.env.AGENT_BOARD_WORKDIR || '.')
};

const mockRequested = process.env.AGENT_BOARD_MOCK === '1';
const realAvailable = codexAvailable(config.codexBin);
const useMock = mockRequested || !realAvailable;

const store = createStore(config.dataDir);
const runner = createRunner({ codexBin: config.codexBin, codexArgs: config.codexArgs, mock: useMock });

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(body);
}

function sendText(response, status, body, contentType) {
  response.writeHead(status, { 'content-type': contentType });
  response.end(body);
}

function readBody(request) {
  return new Promise((accept, reject) => {
    let text = '';
    request.on('data', (chunk) => {
      text += chunk;
      if (text.length > 1024 * 1024) {
        reject(new Error('body too large'));
        request.destroy();
      }
    });
    request.on('end', () => accept(text));
    request.on('error', reject);
  });
}

async function parseJsonBody(request) {
  const text = await readBody(request);
  if (text.length === 0) {
    return {};
  }
  return JSON.parse(text);
}

function publicPath(urlPath) {
  const relative = urlPath === '/' ? '/index.html' : urlPath;
  const resolved = resolve(config.publicDir, '.' + normalize(relative));
  if (!resolved.startsWith(config.publicDir)) {
    return null;
  }
  return resolved;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function servePublic(request, response) {
  const target = publicPath(new URL(request.url, 'http://local').pathname);
  if (!target || !existsSync(target)) {
    sendJson(response, 404, { error: 'not found' });
    return;
  }
  const body = await readFile(target);
  sendText(response, 200, body, MIME[extname(target)] || 'application/octet-stream');
}

async function readTailLines(logPath, tail) {
  if (!existsSync(logPath)) {
    return { lines: [], truncated: false };
  }
  const text = await readFile(logPath, 'utf8');
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length <= tail) {
    return { lines, truncated: false };
  }
  return { lines: lines.slice(lines.length - tail), truncated: true };
}

function toPublicSession(session) {
  return {
    id: session.id,
    prompt: session.prompt,
    workdir: session.workdir,
    blueprint: session.blueprint,
    node: session.node,
    run: session.run || null,
    status: session.status,
    pid: session.pid,
    exitCode: session.exitCode,
    createdAt: session.createdAt,
    finishedAt: session.finishedAt
  };
}

function startSessionRecord(fields) {
  const now = new Date().toISOString();
  return {
    id: runner.newId('sess'),
    prompt: fields.prompt,
    workdir: fields.workdir || config.workdir,
    blueprint: fields.blueprint || null,
    node: fields.node || null,
    run: fields.run || null,
    status: 'running',
    pid: null,
    exitCode: null,
    createdAt: now,
    finishedAt: null
  };
}

async function launchSession(fields) {
  const session = fields.id ? fields : startSessionRecord(fields);
  await mkdir(session.workdir, { recursive: true });
  store.putSession(session);
  await store.recordEvent({ type: 'session.created', run: session.run, session: session.id, node: session.node, blueprint: session.blueprint });
  const handle = runner.start(session, store.logPath(session.id), async (result) => {
    const current = store.getSession(session.id);
    if (!current) {
      return;
    }
    current.status = result.killed ? 'killed' : result.exitCode === 0 ? 'done' : 'failed';
    current.exitCode = result.exitCode;
    current.finishedAt = new Date().toISOString();
    store.putSession(current);
    await store.recordEvent({ type: current.status === 'killed' ? 'session.killed' : 'session.finished', run: current.run, session: session.id, node: session.node, blueprint: session.blueprint, exitCode: current.exitCode });
  });
  session.pid = handle.pid;
  store.putSession(session);
  await store.persist();
  return session;
}

function waitForSession(sessionId, timeoutMs) {
  const started = Date.now();
  return new Promise((accept) => {
    const timer = setInterval(async () => {
      const current = store.getSession(sessionId);
      if (!current || current.status !== 'running' || Date.now() - started > timeoutMs) {
        clearInterval(timer);
        accept(store.getSession(sessionId));
      }
    }, 100);
  });
}

async function listPresets() {
  const files = (await readdir(config.presetsDir)).filter((name) => name.endsWith('.json'));
  const items = [];
  for (const file of files) {
    items.push(JSON.parse(await readFile(join(config.presetsDir, file), 'utf8')));
  }
  return items;
}

async function loadPreset(name) {
  const target = resolve(config.presetsDir, name + '.json');
  if (!target.startsWith(config.presetsDir) || !existsSync(target)) {
    return null;
  }
  return JSON.parse(await readFile(target, 'utf8'));
}

async function presetNames() {
  const presets = await listPresets();
  return new Set(presets.map((preset) => preset.name));
}


function userTemplatesDir() {
  return join(config.dataDir, 'templates');
}

async function templateFiles() {
  const seen = new Map();
  for (const dir of [config.templatesDir, userTemplatesDir()]) {
    let files = [];
    try {
      files = (await readdir(dir)).filter((name) => name.endsWith('.json'));
    } catch {
      files = [];
    }
    for (const file of files) {
      seen.set(file, join(dir, file));
    }
  }
  return seen;
}

async function loadBlueprint(name) {
  const files = await templateFiles();
  const target = files.get(name + '.json');
  if (!target || !existsSync(target)) {
    return null;
  }
  return JSON.parse(await readFile(target, 'utf8'));
}

async function runBlueprint(blueprint, input) {
  const errors = validateBlueprint(blueprint);
  const known = await presetNames();
  for (const node of blueprint.nodes || []) {
    if (node && !known.has(node.agent)) {
      errors.push('node ' + node.id + ' uses unknown agent preset: ' + node.agent);
    }
  }
  if (errors.length > 0) {
    return { errors };
  }
  const presets = new Map((await listPresets()).map((preset) => [preset.name, preset]));
  const effectivePrompt = (node) => {
    const preset = presets.get(node.agent);
    const head = preset && preset.systemPrompt ? preset.systemPrompt + '\n\n' : '';
    return head + node.prompt;
  };
  const edges = blueprint.edges || [];
  const byId = new Map(blueprint.nodes.map((node) => [node.id, node]));
  const run = { id: runner.newId('run'), blueprint: blueprint.name, blueprintVersion: blueprint.version || null, createdAt: new Date().toISOString(), sessions: [] };
  store.putRun(run);
  await store.recordEvent({ type: 'run.started', run: run.id, blueprint: blueprint.name });
  const handoffOrder = orderHandoffNodes(blueprint.nodes, edges);
  const chained = new Set(handoffOrder.filter((nodeId) => edges.some((edge) => edge.kind === 'handoff' && edge.to === nodeId)));
  const outputs = new Map();
  const nodeWorkdir = (nodeId) => join(config.workdir, run.id, nodeId);
  const roots = handoffOrder.filter((nodeId) => !chained.has(nodeId));
  await Promise.all(roots.map(async (nodeId) => {
    const node = byId.get(nodeId);
    const parts = [node.prompt];
    if (input) {
      parts.push('Task input: ' + input);
    }
    const session = await launchSession({ prompt: parts.join('\n\n'), blueprint: blueprint.name, node: nodeId, run: run.id, workdir: nodeWorkdir(nodeId) });
    run.sessions.push(session.id);
    await waitForSession(session.id, 1000 * 60 * 30);
    const tail = await readTailLines(store.logPath(session.id), 40);
    outputs.set(nodeId, tail.lines.join('\n').slice(0, 4000));
  }));
  for (const nodeId of handoffOrder) {
    if (roots.includes(nodeId)) {
      continue;
    }
    const node = byId.get(nodeId);
    const parts = [effectivePrompt(node)];
    if (input) {
      parts.push('Task input: ' + input);
    }
    for (const edge of edges) {
      if (edge.kind === 'handoff' && edge.to === nodeId && outputs.has(edge.from)) {
        parts.push('Handoff instruction: ' + edge.instruction);
        parts.push('Previous output from ' + edge.from + ': ' + outputs.get(edge.from));
        await store.recordEvent({ type: 'handoff.injected', run: run.id, session: null, node: nodeId, from: edge.from, instruction: edge.instruction.slice(0, 200) });
      }
    }
    const session = await launchSession(startSessionRecord({ prompt: parts.join('\n\n'), blueprint: blueprint.name, node: nodeId, run: run.id, workdir: nodeWorkdir(nodeId) }));
    run.sessions.push(session.id);
    const finished = await waitForSession(session.id, 1000 * 60 * 30);
    const tail = await readTailLines(store.logPath(session.id), 40);
    outputs.set(nodeId, tail.lines.join('\n').slice(0, 4000));
    if (!finished || finished.status !== 'done') {
      break;
    }
  }
  for (const node of blueprint.nodes) {
    if (chained.has(node.id) || run.sessions.some((sessionId) => store.getSession(sessionId)?.node === node.id)) {
      continue;
    }
    const parts = [effectivePrompt(node)];
    if (input) {
      parts.push('Task input: ' + input);
    }
    const session = await launchSession({ prompt: parts.join('\n\n'), blueprint: blueprint.name, node: node.id, run: run.id, workdir: nodeWorkdir(node.id) });
    run.sessions.push(session.id);
  }
  store.putRun(run);
  await store.recordEvent({ type: 'run.finished', run: run.id, blueprint: blueprint.name });
  return { run };
}

export function createApp() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://local');
      const segments = url.pathname.split('/').filter((part) => part.length > 0);

      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true, mode: useMock ? 'mock' : 'codex', codexBin: config.codexBin, codexArgs: config.codexArgs });
        return;
      }

      if (request.method === 'GET' && segments[0] === 'api' && segments[1] === 'sessions' && segments.length === 2) {
        sendJson(response, 200, { sessions: store.listSessions().map(toPublicSession) });
        return;
      }

      if (request.method === 'POST' && segments.join('/') === 'api/sessions') {
        const body = await parseJsonBody(request);
        if (typeof body.prompt !== 'string' || body.prompt.length === 0) {
          sendJson(response, 400, { error: 'prompt is required' });
          return;
        }
        let prompt = body.prompt;
        if (typeof body.preset === 'string' && body.preset.length > 0) {
          const preset = await loadPreset(body.preset);
          if (!preset) {
            sendJson(response, 400, { error: 'unknown preset: ' + body.preset });
            return;
          }
          prompt = preset.systemPrompt + '\n\n' + prompt;
        }
        const session = await launchSession({ prompt, workdir: body.workdir });
        sendJson(response, 201, { session: toPublicSession(session) });
        return;
      }

      if (segments[0] === 'api' && segments[1] === 'sessions' && segments.length === 3) {
        const session = store.getSession(segments[2]);
        if (!session) {
          sendJson(response, 404, { error: 'session not found' });
          return;
        }
        sendJson(response, 200, { session: toPublicSession(session) });
        return;
      }

      if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'sessions' && segments[3] === 'kill') {
        const session = store.getSession(segments[2]);
        if (!session) {
          sendJson(response, 404, { error: 'session not found' });
          return;
        }
        if (session.status !== 'running') {
          sendJson(response, 200, { session: toPublicSession(session), killed: false });
          return;
        }
        const stopped = runner.stop(session.id);
        if (!stopped) {
          session.status = 'killed';
          session.finishedAt = new Date().toISOString();
          store.putSession(session);
          await store.persist();
        }
        const updated = await waitForSession(session.id, 5000);
        sendJson(response, 200, { session: toPublicSession(updated || session), killed: true });
        return;
      }

      if (request.method === 'GET' && segments[0] === 'api' && segments[1] === 'sessions' && segments[3] === 'logs') {
        const session = store.getSession(segments[2]);
        if (!session) {
          sendJson(response, 404, { error: 'session not found' });
          return;
        }
        const tail = Math.min(Number(url.searchParams.get('tail') || 200), 2000);
        const result = await readTailLines(store.logPath(session.id), tail);
        sendJson(response, 200, { session: toPublicSession(session), ...result });
        return;
      }

      if (request.method === 'GET' && segments.join('/') === 'api/blueprints') {
        const files = await templateFiles();
        const items = [];
        for (const [file, full] of files) {
          const blueprint = JSON.parse(await readFile(full, 'utf8'));
          items.push({ name: blueprint.name || file.replace(/\.json$/, ''), version: blueprint.version || null, nodes: (blueprint.nodes || []).length, edges: (blueprint.edges || []).length, origin: full.startsWith(userTemplatesDir()) ? 'space' : 'factory' });
        }
        sendJson(response, 200, { blueprints: items });
        return;
      }

      if (request.method === 'GET' && segments[0] === 'api' && segments[1] === 'blueprints' && segments.length === 3) {
        const blueprint = await loadBlueprint(segments[2]);
        if (!blueprint) {
          sendJson(response, 404, { error: 'blueprint not found' });
          return;
        }
        sendJson(response, 200, { blueprint });
        return;
      }

      if (request.method === 'POST' && segments.join('/') === 'api/blueprints/validate') {
        const body = await parseJsonBody(request);
        const candidate = body.blueprint || body;
        const errors = validateBlueprint(candidate);
        const known = await presetNames();
        for (const node of candidate.nodes || []) {
          if (node && !known.has(node.agent)) {
            errors.push('node ' + node.id + ' uses unknown agent preset: ' + node.agent);
          }
        }
        sendJson(response, 200, { ok: errors.length === 0, errors });
        return;
      }

      if (request.method === 'GET' && segments.join('/') === 'api/presets') {
        sendJson(response, 200, { presets: await listPresets() });
        return;
      }

      if (request.method === 'GET' && segments[0] === 'api' && segments[1] === 'presets' && segments.length === 3) {
        const preset = await loadPreset(segments[2]);
        if (!preset) {
          sendJson(response, 404, { error: 'preset not found' });
          return;
        }
        sendJson(response, 200, { preset });
        return;
      }

      if (request.method === 'POST' && segments.join('/') === 'api/spaces/export') {
        const body = await parseJsonBody(request).catch(() => ({}));
        const run = body.run ? store.getRun(body.run) : null;
        if (body.run && !run) {
          sendJson(response, 404, { error: 'run not found' });
          return;
        }
        const files = await templateFiles();
        const blueprints = [];
        for (const [file, full] of files) {
          if (!full.startsWith(userTemplatesDir())) {
            continue;
          }
          blueprints.push(JSON.parse(await readFile(full, 'utf8')));
        }
        const bundle = { format: 'agent-board-space', version: 1, exportedAt: new Date().toISOString(), presets: await listPresets(), blueprints };
        if (run) {
          bundle.run = run;
          bundle.sessions = run.sessions.map((sessionId) => store.getSession(sessionId)).filter(Boolean);
          bundle.events = store.listEvents({ run: run.id });
        }
        sendJson(response, 200, { bundle });
        return;
      }

      if (request.method === 'POST' && segments.join('/') === 'api/spaces/import') {
        const body = await parseJsonBody(request);
        const bundle = body.bundle || body;
        if (!bundle || bundle.format !== 'agent-board-space' || !Array.isArray(bundle.blueprints)) {
          sendJson(response, 400, { ok: false, error: 'not an agent-board space bundle' });
          return;
        }
        const known = await presetNames();
        const imported = [];
        const errors = [];
        for (const blueprint of bundle.blueprints) {
          const problems = validateBlueprint(blueprint);
          for (const node of blueprint.nodes || []) {
            if (node && !known.has(node.agent)) {
              problems.push('node ' + node.id + ' uses unknown agent preset: ' + node.agent);
            }
          }
          if (problems.length > 0) {
            errors.push({ name: (blueprint && blueprint.name) || '?', problems });
            continue;
          }
          const safe = String(blueprint.name).replace(/[^a-z0-9-_]+/gi, '-');
          await mkdir(userTemplatesDir(), { recursive: true });
          await writeFile(join(userTemplatesDir(), safe + '.json'), JSON.stringify(blueprint, null, 2));
          imported.push(blueprint.name);
        }
        sendJson(response, 200, { ok: errors.length === 0, imported, errors });
        return;
      }

      if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'blueprints' && segments[3] === 'run') {
        const blueprint = await loadBlueprint(segments[2]);
        if (!blueprint) {
          sendJson(response, 404, { error: 'blueprint not found' });
          return;
        }
        const body = await parseJsonBody(request).catch(() => ({}));
        const outcome = await runBlueprint(blueprint, body.input || '');
        if (outcome.errors) {
          sendJson(response, 400, { ok: false, errors: outcome.errors });
          return;
        }
        sendJson(response, 201, { run: outcome.run });
        return;
      }

      if (request.method === 'GET' && segments.join('/') === 'api/runs') {
        sendJson(response, 200, { runs: store.listRuns() });
        return;
      }

      if (request.method === 'GET' && segments[0] === 'api' && segments[1] === 'runs' && segments.length === 3) {
        const run = store.getRun(segments[2]);
        if (!run) {
          sendJson(response, 404, { error: 'run not found' });
          return;
        }
        const sessions = run.sessions.map((sessionId) => {
          const session = store.getSession(sessionId);
          return session ? toPublicSession(session) : { id: sessionId, status: 'unknown' };
        });
        sendJson(response, 200, { run: { ...run, sessions } });
        return;
      }

      if (request.method === 'GET' && segments[0] === 'api' && segments[1] === 'runs' && segments[3] === 'timeline') {
        const run = store.getRun(segments[2]);
        if (!run) {
          sendJson(response, 404, { error: 'run not found' });
          return;
        }
        const sessions = run.sessions.map((sessionId) => {
          const session = store.getSession(sessionId);
          return session ? toPublicSession(session) : { id: sessionId, status: 'unknown' };
        });
        sendJson(response, 200, { run: { ...run, sessions }, events: store.listEvents({ run: run.id }) });
        return;
      }

      if (request.method === 'GET' && (url.pathname === '/' || !url.pathname.startsWith('/api/'))) {
        await servePublic(request, response);
        return;
      }

      sendJson(response, 404, { error: 'not found' });
    } catch (error) {
      sendJson(response, 500, { error: String((error && error.message) || error) });
    }
  });
}

export async function startServer() {
  await store.load();
  const server = createApp();
  await new Promise((accept) => server.listen(config.port, config.host, accept));
  return server;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(join(rootDir, 'server.js'));
if (isMain) {
  await store.load();
  const server = createApp();
  server.listen(config.port, config.host, () => {
    process.stdout.write('agent-board listening on http://' + config.host + ':' + config.port + ' mode=' + (useMock ? 'mock' : 'codex') + '\n');
  });
}
