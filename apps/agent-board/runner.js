import { spawn, execFileSync } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export function codexAvailable(codexBin) {
  try {
    execFileSync(codexBin, ['--version'], { stdio: 'ignore', timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

function newId(prefix) {
  return prefix + '_' + randomBytes(6).toString('hex');
}

async function appendLine(logPath, line) {
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, line + '\n');
}

function launchMock(session, logPath, onDone) {
  const lines = [
    '[mock] starting ' + session.id,
    '[mock] prompt chars=' + session.prompt.length,
    '[mock] working in ' + session.workdir,
    '[mock] tool run_command ok',
    '[mock] done'
  ];
  let index = 0;
  let killed = false;
  const timer = setInterval(async () => {
    if (killed) {
      clearInterval(timer);
      return;
    }
    if (index < lines.length) {
      await appendLine(logPath, lines[index]);
      index += 1;
    }
    if (index >= lines.length) {
      clearInterval(timer);
      onDone({ exitCode: 0, killed: false });
    }
  }, 120);
  return {
    pid: -1,
    kill() {
      killed = true;
      clearInterval(timer);
      onDone({ exitCode: null, killed: true });
    }
  };
}

function launchReal(session, logPath, codexBin, codexArgs, onDone) {
  const child = spawn(codexBin, ['exec', ...codexArgs, session.prompt], { cwd: session.workdir, stdio: ['ignore', 'pipe', 'pipe'] });
  appendLine(logPath, '[run] codex exec pid=' + child.pid);
  child.stdout.on('data', (chunk) => {
    appendFile(logPath, chunk).catch(() => {});
  });
  child.stderr.on('data', (chunk) => {
    appendFile(logPath, '[stderr] ' + chunk).catch(() => {});
  });
  child.on('error', async (error) => {
    await appendLine(logPath, '[error] spawn failed: ' + error.message);
    onDone({ exitCode: 1, killed: false, error: error.message });
  });
  child.on('close', (exitCode) => {
    appendLine(logPath, '[run] exit code=' + exitCode).then(() => {
      onDone({ exitCode: exitCode ?? 1, killed: false });
    });
  });
  return {
    pid: child.pid,
    kill() {
      child.kill('SIGTERM');
    }
  };
}

export function createRunner(options) {
  const active = new Map();
  const useMock = options.mock === true;

  function start(session, logPath, onDone) {
    const finish = (result) => {
      active.delete(session.id);
      onDone(result);
    };
    const handle = useMock
      ? launchMock(session, logPath, finish)
      : launchReal(session, logPath, options.codexBin, options.codexArgs || [], finish);
    active.set(session.id, handle);
    return handle;
  }

  return {
    newId,
    get useMock() {
      return useMock;
    },
    start,
    stop(sessionId) {
      const handle = active.get(sessionId);
      if (!handle) {
        return false;
      }
      handle.kill();
      return true;
    },
    isActive(sessionId) {
      return active.has(sessionId);
    }
  };
}
