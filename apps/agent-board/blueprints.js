const EDGE_KINDS = new Set(['handoff', 'fanout']);

export function validateBlueprint(blueprint) {
  const errors = [];
  if (!blueprint || typeof blueprint !== 'object') {
    return ['blueprint must be an object'];
  }
  if (typeof blueprint.name !== 'string' || blueprint.name.length === 0) {
    errors.push('blueprint.name must be a non-empty string');
  }
  const nodes = Array.isArray(blueprint.nodes) ? blueprint.nodes : null;
  if (!nodes || nodes.length === 0) {
    errors.push('blueprint.nodes must be a non-empty array');
    return errors;
  }
  const seen = new Set();
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || node.id.length === 0) {
      errors.push('every node needs a non-empty string id');
      continue;
    }
    if (seen.has(node.id)) {
      errors.push('duplicate node id: ' + node.id);
    }
    seen.add(node.id);
    if (typeof node.agent !== 'string' || node.agent.length === 0) {
      errors.push('node ' + node.id + ' needs an agent preset name');
    }
    if (typeof node.prompt !== 'string' || node.prompt.length === 0) {
      errors.push('node ' + node.id + ' needs a prompt');
    }
  }
  const edges = blueprint.edges === undefined ? [] : blueprint.edges;
  if (!Array.isArray(edges)) {
    errors.push('blueprint.edges must be an array');
    return errors;
  }
  for (const edge of edges) {
    if (!edge || !EDGE_KINDS.has(edge.kind)) {
      errors.push('edge kind must be one of handoff, fanout');
      continue;
    }
    if (!seen.has(edge.from) || !seen.has(edge.to)) {
      errors.push('edge references unknown node: ' + edge.from + ' -> ' + edge.to);
    }
    if (edge.kind === 'handoff' && (typeof edge.instruction !== 'string' || edge.instruction.length === 0)) {
      errors.push('handoff edge ' + edge.from + ' -> ' + edge.to + ' needs an instruction');
    }
  }
  if (errors.length === 0 && hasHandoffCycle(nodes, edges)) {
    errors.push('handoff edges must form a DAG, cycle detected');
  }
  return errors;
}

function hasHandoffCycle(nodes, edges) {
  const visiting = new Set();
  const done = new Set();
  const next = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (edge.kind === 'handoff') {
      next.get(edge.from).push(edge.to);
    }
  }
  function visit(nodeId) {
    if (done.has(nodeId)) {
      return false;
    }
    if (visiting.has(nodeId)) {
      return true;
    }
    visiting.add(nodeId);
    for (const child of next.get(nodeId)) {
      if (visit(child)) {
        return true;
      }
    }
    visiting.delete(nodeId);
    done.add(nodeId);
    return false;
  }
  return nodes.some((node) => visit(node.id));
}

export function orderHandoffNodes(nodes, edges) {
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const next = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (edge.kind === 'handoff') {
      next.get(edge.from).push(edge.to);
      incoming.set(edge.to, incoming.get(edge.to) + 1);
    }
  }
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const ordered = [];
  while (queue.length > 0) {
    const current = queue.shift();
    ordered.push(current);
    for (const child of next.get(current)) {
      incoming.set(child, incoming.get(child) - 1);
      if (incoming.get(child) === 0) {
        queue.push(child);
      }
    }
  }
  return ordered;
}

export function handoffInstruction(blueprint, fromId, toId) {
  const edge = (blueprint.edges || []).find((item) => item.kind === 'handoff' && item.from === fromId && item.to === toId);
  return edge ? edge.instruction : '';
}
