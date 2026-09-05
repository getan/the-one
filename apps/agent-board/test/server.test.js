import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
let base = '';
let child = null;

async function call(path, options) {
  const response = await fetch(base + path, options);
  const body = await response.json();
  return { status: response.status, body };
}

async function waitFor(sessionId, want, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = await call('/api/sessions/' + sessionId);
    if (want.includes(current.body.session.status)) {
      return current.body.session;
    }
    await new Promise((accept) => setTimeout(accept, 100));
  }
  throw new Error('timeout waiting for ' + sessionId);
}

async function waitForHealth(port, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/health');
      if (response.ok) {
        return;
      }
    } catch {
    }
    await new Promise((accept) => setTimeout(accept, 100));
  }
  throw new Error('server did not become healthy');
}

describe('server', () => {
  before(async () => {
    const port = 18081 + Math.floor(Math.random() * 1000);
    child = spawn(process.execPath, [join(rootDir, 'server.js')], {
      env: {
        ...process.env,
        AGENT_BOARD_MOCK: '1',
        AGENT_BOARD_PORT: String(port),
        AGENT_BOARD_DATA: await mkdtemp(join(tmpdir(), 'board-data-')),
        AGENT_BOARD_TEMPLATES: join(rootDir, 'templates'),
        AGENT_BOARD_WORKDIR: await mkdtemp(join(tmpdir(), 'board-work-'))
      },
      stdio: 'ignore'
    });
    await waitForHealth(port, 15000);
    base = 'http://127.0.0.1:' + port;
  });

  after(() => {
    if (child) {
      child.kill('SIGTERM');
    }
  });

  it('reports health in mock mode', async () => {
    const health = await call('/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.mode, 'mock');
  });

  it('rejects sessions without a prompt', async () => {
    const created = await call('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(created.status, 400);
  });

  it('runs a session to done with visible logs', async () => {
    const created = await call('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'draft a plan' }) });
    assert.equal(created.status, 201);
    const finished = await waitFor(created.body.session.id, ['done'], 10000);
    assert.equal(finished.status, 'done');
    const logs = await call('/api/sessions/' + finished.id + '/logs?tail=50');
    assert.ok(logs.body.lines.join('\n').includes('[mock] done'));
  });

  it('kill settles a session out of running', async () => {
    const created = await call('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'long job' }) });
    await call('/api/sessions/' + created.body.session.id + '/kill', { method: 'POST' });
    const settled = await waitFor(created.body.session.id, ['killed', 'done'], 10000);
    assert.ok(['killed', 'done'].includes(settled.status));
  });

  it('validates blueprints through the api', async () => {
    const good = await call('/api/blueprints/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprint: { name: 'x', nodes: [{ id: 'a', agent: 'researcher', prompt: 'p' }], edges: [] } }) });
    assert.equal(good.body.ok, true);
    const bad = await call('/api/blueprints/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprint: { name: 'x', nodes: [], edges: [] } }) });
    assert.equal(bad.body.ok, false);
  });

  it('runs the frontend-studio blueprint with handoff order', async () => {
    const started = await call('/api/blueprints/frontend-studio/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'landing page' }) });
    assert.equal(started.status, 201);
    const runId = started.body.run.id;
    assert.equal(started.body.run.sessions.length, 4);
    const detail = await call('/api/runs/' + runId);
    for (const item of detail.body.run.sessions) {
      await waitFor(item.id, ['done'], 15000);
    }
    const final = await call('/api/runs/' + runId);
    const byNode = new Map(final.body.run.sessions.map((item) => [item.node, item]));
    assert.ok(byNode.get('researcher_a').finishedAt <= byNode.get('director').finishedAt);
    assert.ok(byNode.get('director').finishedAt <= byNode.get('reviewer').finishedAt);
  });

  it('serves presets and injects them into sessions', async () => {
    const listed = await call('/api/presets');
    assert.ok(listed.body.presets.some((preset) => preset.name === 'researcher'));
    const one = await call('/api/presets/director');
    assert.ok(one.body.preset.systemPrompt.includes('exactly one build plan'));
    const missing = await call('/api/presets/ghost');
    assert.equal(missing.status, 404);
    const created = await call('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'go', preset: 'researcher' }) });
    assert.equal(created.status, 201);
    const detail = await call('/api/sessions/' + created.body.session.id);
    assert.ok(detail.body.session.prompt.includes('bullet points only'));
    await call('/api/sessions/' + created.body.session.id + '/kill', { method: 'POST' });
    const rejected = await call('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'go', preset: 'ghost' }) });
    assert.equal(rejected.status, 400);
  });

  it('rejects blueprints using unknown agent presets', async () => {
    const checked = await call('/api/blueprints/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprint: { name: 'x', nodes: [{ id: 'a', agent: 'ghost', prompt: 'p' }], edges: [] } }) });
    assert.equal(checked.body.ok, false);
    assert.ok(checked.body.errors.some((line) => line.includes('unknown agent preset')));
  });

  it('records an ordered run timeline', async () => {
    const started = await call('/api/blueprints/frontend-studio/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'cards' }) });
    const runId = started.body.run.id;
    const detail = await call('/api/runs/' + runId);
    for (const item of detail.body.run.sessions) {
      await waitFor(item.id, ['done'], 15000);
    }
    const timeline = await call('/api/runs/' + runId + '/timeline');
    const types = timeline.body.events.map((event) => event.type);
    assert.equal(types[0], 'run.started');
    assert.equal(types[types.length - 1], 'run.finished');
    assert.ok(types.includes('handoff.injected'));
    const injected = timeline.body.events.find((event) => event.type === 'handoff.injected');
    assert.equal(injected.from, 'researcher_a');
    const created = timeline.body.events.filter((event) => event.type === 'session.created');
    assert.equal(created.length, 4);
    assert.ok(created.every((event) => event.run === runId && typeof event.session === 'string'));
    const listed = await call('/api/runs');
    assert.ok(listed.body.runs.some((run) => run.id === runId));
  });

  it('isolates each node in its own workdir', async () => {
    const started = await call('/api/blueprints/chain-smoke/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: '' }) });
    assert.equal(started.status, 201);
    const runId = started.body.run.id;
    assert.equal(started.body.run.sessions.length, 2);
    const detail = await call('/api/runs/' + runId);
    for (const item of detail.body.run.sessions) {
      await waitFor(item.id, ['done'], 15000);
    }
    const final = await call('/api/runs/' + runId);
    for (const item of final.body.run.sessions) {
      assert.ok(item.workdir.endsWith('/' + runId + '/' + item.node));
      const stat = await import('node:fs/promises').then((fs) => fs.stat(item.workdir));
      assert.ok(stat.isDirectory());
    }
    const timeline = await call('/api/runs/' + runId + '/timeline');
    assert.ok(timeline.body.events.some((event) => event.type === 'handoff.injected' && event.from === 'maker'));
  });

  it('exports and imports spaces with runs', async () => {
    const listed = await call('/api/blueprints');
    const smoke = listed.body.blueprints.find((item) => item.name === 'chain-smoke');
    assert.equal(smoke.origin, 'factory');
    assert.equal(smoke.version, '0.1.0');
    const started = await call('/api/blueprints/chain-smoke/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: '' }) });
    const runId = started.body.run.id;
    assert.equal(started.body.run.blueprintVersion, '0.1.0');
    const detail = await call('/api/runs/' + runId);
    for (const item of detail.body.run.sessions) {
      await waitFor(item.id, ['done'], 15000);
    }
    const exported = await call('/api/spaces/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ run: runId }) });
    assert.equal(exported.body.bundle.format, 'agent-board-space');
    assert.equal(exported.body.bundle.run.id, runId);
    assert.ok(exported.body.bundle.sessions.length === 2);
    assert.ok(exported.body.bundle.events.length > 0);
    const bad = await call('/api/spaces/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bundle: { format: 'nope' } }) });
    assert.equal(bad.status, 400);
    const broken = await call('/api/spaces/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bundle: { format: 'agent-board-space', blueprints: [{ name: 'broken', nodes: [], edges: [] }] } }) });
    assert.equal(broken.body.ok, false);
    const good = await call('/api/spaces/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bundle: { format: 'agent-board-space', blueprints: [{ name: 'imported-echo', version: '0.2.0', nodes: [{ id: 'solo', agent: 'echo', prompt: 'Say hi.' }], edges: [] }] } }) });
    assert.equal(good.body.ok, true);
    assert.deepEqual(good.body.imported, ['imported-echo']);
    const relisted = await call('/api/blueprints');
    const mine = relisted.body.blueprints.find((item) => item.name === 'imported-echo');
    assert.equal(mine.origin, 'space');
    assert.equal(mine.version, '0.2.0');
    const solo = await call('/api/blueprints/imported-echo/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: '' }) });
    assert.equal(solo.status, 201);
    const soloDetail = await call('/api/runs/' + solo.body.run.id);
    for (const item of soloDetail.body.run.sessions) {
      await waitFor(item.id, ['done'], 15000);
    }
  });

  it('serves the web page', async () => {
    const response = await fetch(base + '/');
    const text = await response.text();
    assert.ok(text.includes('Agent Board'));
  });
});
