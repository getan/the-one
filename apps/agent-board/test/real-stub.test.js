import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
let base = '';
let child = null;

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

describe('real runner wiring', () => {
  before(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'board-stub-'));
    const stub = join(dir, 'codex-stub.sh');
    await writeFile(stub, '#!/bin/sh\nif read -t 1 line; then echo STUB_STDIN_OPEN; else echo STUB_STDIN_CLOSED; fi\necho "STUB_ARGS $*"\n');
    await chmod(stub, 0o755);
    const port = 19081 + Math.floor(Math.random() * 500);
    child = spawn(process.execPath, [join(rootDir, 'server.js')], {
      env: {
        ...process.env,
        AGENT_BOARD_PORT: String(port),
        AGENT_BOARD_DATA: await mkdtemp(join(tmpdir(), 'board-data-')),
        AGENT_BOARD_TEMPLATES: join(rootDir, 'templates'),
        AGENT_BOARD_WORKDIR: await mkdtemp(join(tmpdir(), 'board-work-')),
        AGENT_BOARD_CODEX: stub
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

  it('spawns the binary with closed stdin and the prompt', async () => {
    const health = await (await fetch(base + '/health')).json();
    assert.equal(health.mode, 'codex');
    const created = await (await fetch(base + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'stub hello' }) })).json();
    const started = Date.now();
    let status = 'running';
    while (status === 'running' && Date.now() - started < 10000) {
      await new Promise((accept) => setTimeout(accept, 100));
      status = (await (await fetch(base + '/api/sessions/' + created.session.id)).json()).session.status;
    }
    assert.equal(status, 'done');
    const logs = await (await fetch(base + '/api/sessions/' + created.session.id + '/logs?tail=20')).json();
    const text = logs.lines.join('\n');
    assert.ok(text.includes('STUB_STDIN_CLOSED'));
    assert.ok(text.includes('--skip-git-repo-check'));
    assert.ok(text.includes('stub hello'));
  });
});
