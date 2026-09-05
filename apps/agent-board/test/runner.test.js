import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunner, codexAvailable } from '../runner.js';

describe('runner', () => {
  it('reports a bogus binary as unavailable', () => {
    assert.equal(codexAvailable('definitely-not-a-binary-xyz'), false);
  });

  it('mock run writes the full scripted chain', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'board-runner-'));
    const logPath = join(dir, 'sess.log');
    const runner = createRunner({ codexBin: 'codex', mock: true });
    const session = { id: 'sess_mock1', prompt: 'hello', workdir: dir };
    const result = await new Promise((accept) => {
      runner.start(session, logPath, accept);
    });
    assert.equal(result.exitCode, 0);
    const text = await readFile(logPath, 'utf8');
    assert.ok(text.includes('[mock] done'));
    assert.ok(text.includes('prompt chars=5'));
  });

  it('mock run can be killed mid-flight', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'board-runner-'));
    const logPath = join(dir, 'sess.log');
    const runner = createRunner({ codexBin: 'codex', mock: true });
    const session = { id: 'sess_mock2', prompt: 'hello', workdir: dir };
    const done = new Promise((accept) => {
      runner.start(session, logPath, accept);
    });
    assert.equal(runner.isActive(session.id), true);
    assert.equal(runner.stop(session.id), true);
    const result = await done;
    assert.equal(result.killed, true);
    assert.equal(runner.isActive(session.id), false);
  });
});
