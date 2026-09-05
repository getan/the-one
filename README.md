<div align="center">
  <img src="./app_icon.png" alt="The One" width="96" />

  <h1>The One</h1>

  <p>
    <strong>Web 可部署的多 Agent 管理与编排工具（一人一容器，与 code-server 并存）。</strong>
  </p>

  <p>
    <strong>简体中文</strong>
    |
    <a href="./README.zh-CN.md">English Summary</a>
  </p>

  <p>
    <a href="https://the-zeroth.com">The Zeroth 官网（概念参考）</a>
    |
    <a href="https://github.com/getan/the-one">本仓库</a>
  </p>
</div>

---

## English Summary

The One (this repo) is a web-deployable multi-agent management and orchestration tool for cloud dev spaces: one container per engineer, running alongside code-server behind Caddy with unified auth. The Orca open-source app is the executable shell (sessions, isolation, log streaming); The Zeroth's The One contributes the orchestration concepts (Graph blueprints, handoff edges, god-view observability, reusable team genes). Phase one supports Codex only, developed and trialed locally on Mac first.

---

## 1. 背景与目标

公司在搞 AI 云空间研发：一个 ECS 上跑多个 podman 容器，一个容器对应一位同事，Mac 浏览器经统一入口（Caddy + 统一鉴权）访问，code-server 已被烘进共享镜像、每人一个。

本项目要在同样的交付形态下，再提供一种 Web 部署的多 Agent 管理及编排工具：和 code-server 一样烘进镜像、一容器跑一个、挂在 Caddy 后面开箱即用。一期只接 Codex，先在 Mac 本地开发并用浏览器试用。

## 2. 总体方案：Orca 为壳，The One 为魂

- **主体用 Orca（开源 MIT，可真跑）**：会话管理、多 Agent 并行、工作区隔离、日志/终端流。它已有 `dev:web / build:web` 的 Web 口（`src/renderer/web-index.html` → `out/web`，注释写明为反代子路径准备），壳直接复用。
- **编排抄 The One（闭源，只抄概念）**：Graph 蓝图（节点绑 Agent 预设、边即移交指令）、路由器 Agent 拉起子图、上帝视角可观察、一支小组写成可复用基因。不碰其实现。
- **开源拼图**：运行时选 `LangGraph.js`（TS 栈，节点+边+状态+检查点，最贴 Graph DAG）；`handoff` 语义对标 OpenAI Agents SDK；蓝图即基因的文件格式对标 `agent-blueprint` 的单 YAML 哲学（`lint/test/trace` 运维环照搬思路）。

## 3. 两者关系：DAG 与并行不是对立面

- The One 的 Graph 是**协作 DAG**（接力赛）：边写清何时交、交什么、要什么产出，可父子嵌套（`create_subgraph`，父 Agent 给子图当人类）。
- Orca 的并行是**竞速池**（赛马）：同一提示扇出到 N 个隔离 worktree 各跑各的，人来对比合并。
- 粘合点现成的：Orca 的扇出 = The One 的分裂（Division，一个 Agent 变多个处理有界工作，经 clone 或 TaskBoard）。统一模型：**DAG 管协作流转，节点内部允许挂并行池，边只定义交接和验收**。

## 4. 部署形态：学 code-server

```text
ECS 宿主机（root 自管）
└── podman 容器 A（同事甲）: code-server :8080 + agent-board :8081 + 数据卷
└── podman 容器 B（同事乙）: code-server :8080 + agent-board :8081 + 数据卷
        ↑
   Caddy 按人分子路由 + 统一鉴权（公司侧已有，本地用 localhost:8081 联调）
```

- 单端口、无数据库：`Node` 服务同端口 serve 静态页，状态落文件卷，容器重建不丢模版。
- 烘进共享镜像：`node:20-slim` 多一层，与 code-server 并存，Caddy 每用户加一行 `reverse_proxy`。
- 护栏：共享 ECS 上不允许无界增殖，每容器设预算和一键拆除，审计日志先行。

## 5. Orca Web 现状与三处改造

Orca 不是没有 Web，而是有**远控式 Web**：浏览器跑同一套 React App，执行留在宿主（桌面/SSH 远端），靠配对连 runtime（心跳、订阅、线兼容俱全）；`cloud/` 是连手机的中继，不是容器后端。要改的三件事：

1. **鉴权**：配对码换成 Caddy 统一鉴权，每容器自动连自己的运行时。
2. **运行时**：容器里跑宿主侧（`orcad`/远端执行那套），P0 只接 Codex、目录级隔离，worktree 和多后端后置。
3. **功能**：加 `Graphs` 一级视图（蓝图列表 + 画布先只读 + 移交边文本 + 运行时间线），Electron 专属件换 Web 实现（终端用 xterm.js、通信走 HTTP/SSE）。

另见 `AGENTS.md` 式约束（Orca 侧）：远端线兼容（新字段可选、opcode 需能力协商）、执行边界（失联≠死亡，只判 `live/unverifiable/exited`）、跨平台与工作区兼容——改造时必须遵守，本仓库后续同样立一份。

## 6. UI 参照（The Zeroth 官网实机，已逐张确认）

深色高密度控制台风，衬线斜体标题 + 暗金点缀，信息全摊开、可介入：

- **运行三栏**：左会话列表，中工作链（`TOOL CALLS / REASONING / run_command / write` 逐行展开，可 `Interrupt`），右 Agent Roster（状态、模型、`cycles`、上下文百分比、耗时），底部人类上下文输入 + `Freeze`。
- **Graph 编辑器**：左图列表（`N NODES · M EDGES`），中画布节点卡（绑定预设 + `CONTEXT` 数），右 Edge Inspector（`FROM→TO` + 移交正文，注明运行时原样注入），`Apply/Delete Edge` 收尾。
- **Atlas 总览**：`PROMPTS / AGENTS / GRAPHS / SKILLS` 分区砖墙 + 血缘线，`Back to overview` 下钻。
- **运行时图弹窗**：父 assistant → 子图多节点链，每节点 `MODEL / TOOLS / 运行态`，`subGraph` 边可点穿透。
- **预设/Space 页**：`NAME / INHERITANCE / 结构化 Prompt 挂载 / 模型回退`，Space 区分只读出厂与可编辑副本。

## 7. 分期与验收

- **P0（Mac 本地）**：单后端 Codex、目录级隔离、拉起/围观/kill、日志轮询；页面三栏抄运行视图，画布只读。验收：在本机浏览器开任务、看流、停掉。
- **P1（进镜像）**：单端口 + 数据卷 + `Caddy` 片段，与 code-server 并存；鉴权切 Caddy。验收：容器内与本地同一套代码，域名一切换即用。
- **P2（The One lite）**：移交边、模版版本化、`.zerospace` 式导入导出；再补 worktree 隔离与多后端。验收：成熟分工存成模版，换容器可复现。

## 8. 仓库结构（规划）

```text
apps/
└── agent-board/        P0 起点：Node+TS 后端（会话/日志/模版 API）+ React+Vite 前端
content/docs/          原双语文档（见下节），继续作为概念与验收来源
public/docs-assets/    文档截图与演示视频
resources/             原始视频资源
scripts/               文档迁移脚本
```

## 9. 文档区（原仓库内容，原样保留为概念来源）

以下为原 `the-zeroth-docs` 的有用信息，继续有效；概念细节以此为准，实现以本 README 为准。

正式文档位于 `content/docs/en` 与 `content/docs/zh`，两种语言使用相同 slug，站点可基于同一路由做语言切换：

```text
content/docs
+-- en/                            English documentation
|   +-- index.mdx                  Entry page
|   +-- start/                     Quick start, pricing, and release notes
|   |   `-- release-notes/         Release note versions
|   +-- the-one-app/               The One app guide
|   |   +-- definition-space/      Profile, MCP, Agent, and Graph
|   |   +-- run/                   Runtime entry
|   |   `-- settings/              Space and API configuration
|   `-- multi-agent-architecture/  Multi-Agent architecture
|       +-- single-agent/          Model, tools, context, ReAct, action sequence
|       +-- evolution/             From single Agent to Multi-Agent
|       `-- more-possibilities/    Communication, context editing, dynamic Graph
`-- zh/                            Chinese documentation (same slugs)
```

- `docs_md`：本地新文档草稿来源（Git 忽略）；`resources`：原始视频；`public/docs-assets/images|videos`：页面引用的截图与演示视频。
- 生成方式：`python scripts\migrate_docs_md.py`——清掉旧 `content/docs` 占位，重建 `en/zh` 双语树，复制资源到 `public/docs-assets`，把占位改写为可部署的 `/docs-assets/...` 引用。
- 对开发最有用的文档：`multi-agent-architecture/*`（single-agent、evolution、a-genetic-engineering、prolifera-engineering、communication/context-editing/dynamic-graph/meditation/self-evolution）、`the-one-app/definition-space|run` 的交互流程、`start/release-notes/0-1-0→0-3-0` 的分期思路。注意：文档无源码、无 API、无完整蓝图协议，只当验收清单，不当协议抠。

## 10. 维护原则

- 中英文文档保持相同 slug，避免语言切换路由漂移；面向用户的表达进 `content/docs`，原始草稿进本地 `docs_md`；截图视频只走 `public/docs-assets`。
- 产品代码进 `apps/`，文档与产品互不串目录；密钥、账号、私有基础设施不进仓库。
- 远端：`origin` = `https://github.com/getan/the-one.git`（本项目），`upstream` = 原文档上游（概念同步用，只读）。

## 11. 下一步

1. 出 P0 页面与接口清单（`Graphs` 视图字段 + 会话/日志 API）。
2. 最小蓝图 YAML 草案（两种边：串行移交、并行扇出）+ 事件流结构。
3. Mac 本地跑通后给 `Containerfile` + `Caddy` 片段。

## 12. 进展记录

- 2026-09-05 远端与方案：`origin` 切到 `getan/the-one`（SSH），老地址改 `upstream` 只读；`README` 重写为本方案文档。
- 2026-09-05 P0 后端 `apps/agent-board` 落地：零依赖 Node 单端口（UI 同端口 serve），会话拉起/围观/kill、日志轮询、蓝图校验与运行（fanout 根并发 + handoff 串行注入上游产出与边指令）、`frontend-studio` 示例模版。
- 2026-09-05 自动化测试 16/16：蓝图校验 5、mock runner 3、HTTP 全链路 7（含蓝图运行顺序断言）、真进程回归 1（stub 断言 stdin 关闭 + 参数透传）。沙箱禁本地监听，测试在沙箱外跑。
- 2026-09-05 Mac 真机验证通过：`mode=codex`，`codex exec` 最小任务回 `BOARD_OK`、`exit 0`，Web 三栏页可开。途中修了三个 bug：子进程 stdin 未关闭导致 codex 空等；workdir 非信任目录需 `--skip-git-repo-check`（已做成 `AGENT_BOARD_CODEX_ARGS` 默认）；runner 变量作用域笔误。
- 2026-09-05 P1 本地完整功能：Agent 预设（`templates/presets`，蓝图节点必须引用已知预设，运行时自动前置 system prompt，单会话也可指定 preset）；事件时间线（`run.started`→并行研究员→`handoff.injected`→director→reviewer→`run.finished`，会话挂 run 关联）；Web 页加只读 Graph 画布（按移交深度分层，handoff 金线/fanout 蓝线）与最新运行时间线。测试 19/19，活体 mock 全链路已验。途中修：时间线漏会话事件（补 run 关联）、旧用例跟进预设校验。
- 2026-09-05 P2 真链验证：节点目录隔离（`<workdir>/<run>/<node>` 自动建）；`chain-smoke` 双节点真模型链——maker 输出 `HELLO_CHAIN`，经边指令注入 checker 并被原样复述，全 `done`。测试 20/20（含隔离断言）。
- 下一步：P1 进镜像（`Containerfile` + 数据卷 + `Caddy` 片段，鉴权切 Caddy）。
