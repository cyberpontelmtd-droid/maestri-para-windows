# Arquitetura do Sistema — Alguns Mestre

## Visão Geral
Sistema de workspace visual multi-agente para desenvolvimento de software assistido por IA.

## Stack Tecnológico
- **Frontend**: React 18 + TypeScript + Vite + React Flow + xterm.js
- **Backend**: Node.js + Express + TypeScript + Anthropic SDK + node-pty + WebSocket
- **IA**: Claude (Haiku 4.5 / Sonnet 4.6 / Opus 4.7) via Anthropic API
- **Persistência**: Arquivos `.json` (layout) e `.md` (vault/memórias)
- **Terminal**: node-pty com WebSocket para PTY real

## Estrutura de Pastas
```
alguns-mestre/
├── frontend/src/
│   ├── App.tsx              — canvas principal com React Flow
│   ├── api.ts               — chamadas ao backend
│   └── components/
│       ├── AgentNode.tsx    — nó agente simples (nota→agente→nota)
│       ├── EntityNode.tsx   — entidade completa (terminal+notas+cérebro+agente)
│       ├── NoteNode.tsx     — nota markdown editável
│       ├── TextNode.tsx     — bloco de texto estático
│       ├── FileTreeNode.tsx — árvore de arquivos do projeto
│       └── TerminalNode.tsx — terminal standalone
├── backend/src/
│   └── server.ts            — API REST + WebSocket
├── vault/                   — memórias e notas dos agentes
│   └── {entidade}/brain/    — cérebro da entidade
└── layout.json              — estado do canvas (nós + arestas)
```

## APIs do Backend
| Método | Rota | Função |
|--------|------|--------|
| GET | /api/layout | Carrega layout do canvas |
| POST | /api/layout | Salva layout do canvas |
| POST | /api/run-agent-stream | Roda agente simples com SSE |
| POST | /api/entities/:name/agent-stream | Roda agente de entidade com SSE |
| GET/POST | /api/entities/:name/brain/:file | CRUD de memórias do cérebro |
| GET/POST | /api/entities/:name/notes/:file | CRUD de notas da entidade |
| WS | ws://localhost:3001 | Terminal PTY |

## Fluxo de Dados — Agente de Entidade
1. Frontend envia `{message, systemPrompt, model, saveToBrain}` via POST
2. Backend carrega todos os `.md` do brain como contexto
3. Claude gera resposta via streaming SSE
4. Se `saveToBrain=true`, salva em `brain/memoria-{timestamp}.md`

## Agentes Planejados
- **Hermes (Planejador)** — arquiteto, coordenador ✅
- **executor_01** — executor de tarefas de código (pendente definição)
- Futuros: Revisor de Código, Analista, Gerador de Docs, Testador
