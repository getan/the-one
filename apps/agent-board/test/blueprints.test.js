import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBlueprint, orderHandoffNodes } from '../blueprints.js';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

describe('blueprints', () => {
  it('accepts the shipped frontend-studio template', async () => {
    const blueprint = JSON.parse(await readFile(join(templatesDir, 'frontend-studio.json'), 'utf8'));
    assert.deepEqual(validateBlueprint(blueprint), []);
  });

  it('rejects handoff edges without instruction', () => {
    const errors = validateBlueprint({
      name: 'bad',
      nodes: [{ id: 'a', agent: 'x', prompt: 'p' }, { id: 'b', agent: 'y', prompt: 'q' }],
      edges: [{ kind: 'handoff', from: 'a', to: 'b' }]
    });
    assert.ok(errors.some((line) => line.includes('instruction')));
  });

  it('rejects edges pointing at unknown nodes', () => {
    const errors = validateBlueprint({
      name: 'bad',
      nodes: [{ id: 'a', agent: 'x', prompt: 'p' }],
      edges: [{ kind: 'fanout', from: 'a', to: 'ghost' }]
    });
    assert.ok(errors.some((line) => line.includes('unknown node')));
  });

  it('rejects handoff cycles', () => {
    const errors = validateBlueprint({
      name: 'cycle',
      nodes: [{ id: 'a', agent: 'x', prompt: 'p' }, { id: 'b', agent: 'y', prompt: 'q' }],
      edges: [
        { kind: 'handoff', from: 'a', to: 'b', instruction: 'go' },
        { kind: 'handoff', from: 'b', to: 'a', instruction: 'back' }
      ]
    });
    assert.ok(errors.some((line) => line.includes('cycle')));
  });

  it('orders handoff chains before reviewers', async () => {
    const blueprint = JSON.parse(await readFile(join(templatesDir, 'frontend-studio.json'), 'utf8'));
    const ordered = orderHandoffNodes(blueprint.nodes, blueprint.edges);
    assert.ok(ordered.indexOf('researcher_a') < ordered.indexOf('director'));
    assert.ok(ordered.indexOf('director') < ordered.indexOf('reviewer'));
  });
});
