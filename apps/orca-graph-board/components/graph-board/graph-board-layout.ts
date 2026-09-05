import type { GraphBoardBlueprint } from '../../web/preload-api/web-graph-board-api'

export interface GraphBoardPoint {
  x: number
  y: number
}

export interface GraphBoardPlacedNode extends GraphBoardPoint {
  id: string
}

export interface GraphBoardPlacedEdge {
  from: GraphBoardPoint
  to: GraphBoardPoint
  kind: 'handoff' | 'fanout'
}

export interface GraphBoardLayout {
  nodes: GraphBoardPlacedNode[]
  edges: GraphBoardPlacedEdge[]
  width: number
  height: number
}

export const GRAPH_BOARD_NODE_GAP_X = 120
export const GRAPH_BOARD_NODE_GAP_Y = 96
export const GRAPH_BOARD_MARGIN = 48

export function layoutGraphBoard(blueprint: Pick<GraphBoardBlueprint, 'nodes' | 'edges'>): GraphBoardLayout {
  const depth = new Map(blueprint.nodes.map((node) => [node.id, 0]))
  let changed = true
  while (changed) {
    changed = false
    for (const edge of blueprint.edges ?? []) {
      if (edge.kind !== 'handoff') {
        continue
      }
      const next = (depth.get(edge.from) ?? 0) + 1
      if (next > (depth.get(edge.to) ?? 0)) {
        depth.set(edge.to, next)
        changed = true
      }
    }
  }
  const lanes = new Map<number, number>()
  const placed = new Map<string, GraphBoardPoint>()
  for (const node of blueprint.nodes) {
    const level = depth.get(node.id) ?? 0
    const lane = lanes.get(level) ?? 0
    lanes.set(level, lane + 1)
    placed.set(node.id, {
      x: GRAPH_BOARD_MARGIN + lane * GRAPH_BOARD_NODE_GAP_X,
      y: GRAPH_BOARD_MARGIN + level * GRAPH_BOARD_NODE_GAP_Y
    })
  }
  const nodes = blueprint.nodes.map((node) => ({ id: node.id, ...(placed.get(node.id) ?? { x: 0, y: 0 }) }))
  const edges = (blueprint.edges ?? [])
    .filter((edge) => placed.has(edge.from) && placed.has(edge.to))
    .map((edge) => ({
      from: placed.get(edge.from) as GraphBoardPoint,
      to: placed.get(edge.to) as GraphBoardPoint,
      kind: edge.kind
    }))
  const width = Math.max(GRAPH_BOARD_MARGIN * 2, ...nodes.map((node) => node.x + GRAPH_BOARD_MARGIN))
  const height = Math.max(GRAPH_BOARD_MARGIN * 2, ...nodes.map((node) => node.y + GRAPH_BOARD_MARGIN))
  return { nodes, edges, width, height }
}
