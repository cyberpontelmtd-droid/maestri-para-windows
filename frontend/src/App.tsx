import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  BackgroundVariant,
} from '@xyflow/react';
import type { NodeChange, EdgeChange, Node, Edge, Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TerminalSquare, StickyNote, FolderTree, Bot, Type, Plus, Trash2, FolderOpen, Users, LogOut } from 'lucide-react';
import TerminalNode from './components/TerminalNode';
import NoteNode from './components/NoteNode';
import FileTreeNode from './components/FileTreeNode';
import AgentNode from './components/AgentNode';
import TextNode from './components/TextNode';
import EntityNode from './components/EntityNode';
import LoginPage from './components/LoginPage';

const ENTITY_COLORS = ['#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'];
import { getLayout, saveLayout, getWorkspaces, deleteWorkspace, me, logout } from './api';

const nodeTypes = {
  terminal: TerminalNode,
  note: NoteNode,
  filetree: FileTreeNode,
  agent: AgentNode,
  text: TextNode,
  entity: EntityNode,
};

const DEFAULT_SIZES: Record<string, { width: number; height: number }> = {
  terminal: { width: 600, height: 380 },
  note: { width: 360, height: 280 },
  filetree: { width: 280, height: 340 },
  agent: { width: 300, height: 280 },
  text: { width: 280, height: 200 },
  entity: { width: 640, height: 480 },
};

// ── Workspace Sidebar ─────────────────────────────────────────────────────────

interface SidebarProps {
  workspaces: string[];
  current: string;
  onSwitch: (name: string) => void;
  onNew: () => void;
  onDelete: (name: string) => void;
  username: string;
  onLogout: () => void;
}

function WorkspaceSidebar({ workspaces, current, onSwitch, onNew, onDelete, username, onLogout }: SidebarProps) {
  return (
    <div className="workspace-sidebar">
      <div className="workspace-sidebar-header">
        <FolderOpen size={14} />
        <span>Workspaces</span>
      </div>
      <div className="workspace-list">
        {workspaces.map(ws => (
          <div
            key={ws}
            className={`workspace-item${current === ws ? ' active' : ''}`}
            onClick={() => onSwitch(ws)}
          >
            <span className="workspace-name">{ws}</span>
            {ws !== 'default' && (
              <button
                className="workspace-delete"
                onClick={e => { e.stopPropagation(); onDelete(ws); }}
                title="Excluir workspace"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
      <button className="workspace-new-btn" onClick={onNew}>
        <Plus size={13} /> Novo Workspace
      </button>
      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {username}
        </span>
        <button
          onClick={onLogout}
          title="Sair"
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', padding: 4 }}
        >
          <LogOut size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Canvas (autenticado) ──────────────────────────────────────────────────────

interface CanvasProps {
  username: string;
  onLogout: () => void;
}

function Canvas({ username, onLogout }: CanvasProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [currentWorkspace, setCurrentWorkspace] = useState('default');
  const [workspaces, setWorkspaces] = useState<string[]>(['default']);
  const currentWorkspaceRef = useRef(currentWorkspace);
  currentWorkspaceRef.current = currentWorkspace;

  // Load workspaces list
  useEffect(() => {
    getWorkspaces().then(setWorkspaces).catch(() => {});
  }, []);

  // Load layout for workspace
  const loadWorkspace = useCallback(async (ws: string) => {
    setLoaded(false);
    try {
      const layout = await getLayout(ws);
      if (layout?.nodes) {
        setNodes(layout.nodes);
        setEdges(layout.edges || []);
      } else {
        setNodes([]);
        setEdges([]);
      }
    } catch {
      setNodes([]);
      setEdges([]);
    }
    setLoaded(true);
  }, []);

  useEffect(() => { loadWorkspace('default'); }, []);

  // Persist layout
  const persistLayout = useCallback((newNodes: Node[], newEdges: Edge[]) => {
    if (!loaded) return;
    saveLayout({ nodes: newNodes, edges: newEdges }, currentWorkspaceRef.current).catch(() => {});
  }, [loaded]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes(nds => {
        const next = applyNodeChanges(changes, nds);
        const shouldSave = changes.some(c =>
          c.type === 'remove' ||
          (c.type === 'position' && !c.dragging) ||
          c.type === 'dimensions'
        );
        if (shouldSave) persistLayout(next, edges);
        return next;
      });
    },
    [edges, persistLayout],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges(eds => {
        const next = applyEdgeChanges(changes, eds);
        persistLayout(nodes, next);
        return next;
      });
    },
    [nodes, persistLayout],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges(eds => {
        const next = addEdge(
          { ...params, animated: true, style: { stroke: '#3b82f6', strokeWidth: 2 } },
          eds
        );
        persistLayout(nodes, next);
        return next;
      });
    },
    [nodes, persistLayout],
  );

  const addNode = (type: string, data: Record<string, unknown>) => {
    const size = DEFAULT_SIZES[type] ?? { width: 300, height: 250 };
    const node: Node = {
      id: `${type}-${Date.now()}`,
      type,
      position: { x: Math.random() * 500 + 220, y: Math.random() * 400 + 80 },
      style: { width: size.width, height: size.height },
      data,
    };
    setNodes(nds => {
      const next = [...nds, node];
      persistLayout(next, edges);
      return next;
    });
  };

  // Workspace management
  const handleSwitchWorkspace = async (ws: string) => {
    await saveLayout({ nodes, edges }, currentWorkspace);
    setCurrentWorkspace(ws);
    currentWorkspaceRef.current = ws;
    await loadWorkspace(ws);
  };

  const handleNewWorkspace = async () => {
    const name = window.prompt('Nome do novo workspace:')?.trim();
    if (!name || name === 'default') return;
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    await saveLayout({ nodes: [], edges: [] }, safe);
    const updated = await getWorkspaces();
    setWorkspaces(updated);
    handleSwitchWorkspace(safe);
  };

  const handleDeleteWorkspace = async (name: string) => {
    if (!window.confirm(`Excluir workspace "${name}"?`)) return;
    await deleteWorkspace(name);
    const updated = await getWorkspaces();
    setWorkspaces(updated);
    if (currentWorkspace === name) handleSwitchWorkspace('default');
  };

  if (!loaded) {
    return <div style={{ color: 'white', padding: 20, background: '#0f1115', height: '100vh' }}>Carregando...</div>;
  }

  const handleLogout = async () => {
    await logout();
    onLogout();
  };

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
      <WorkspaceSidebar
        workspaces={workspaces}
        current={currentWorkspace}
        onSwitch={handleSwitchWorkspace}
        onNew={handleNewWorkspace}
        onDelete={handleDeleteWorkspace}
        username={username}
        onLogout={handleLogout}
      />

      <div style={{ flex: 1, position: 'relative' }}>
        {/* Top toolbar */}
        <div className="ui-panel glass-panel">
          <button className="ui-btn" onClick={() => addNode('terminal', { label: 'Terminal' })}>
            <TerminalSquare size={15} /> Terminal
          </button>
          <button className="ui-btn" onClick={() => addNode('note', { filename: `Nota-${Date.now()}.md`, content: '' })}>
            <StickyNote size={15} /> Nota
          </button>
          <button className="ui-btn" onClick={() => addNode('text', { text: '', colorIdx: 0 })}>
            <Type size={15} /> Texto
          </button>
          <button className="ui-btn" onClick={() => addNode('filetree', {})}>
            <FolderTree size={15} /> Arquivos
          </button>
          <button
            className="ui-btn"
            style={{ background: 'rgba(139, 92, 246, 0.2)', borderColor: 'rgba(139, 92, 246, 0.4)' }}
            onClick={() => addNode('agent', { systemPrompt: 'Você é um agente inteligente.', model: 'claude-sonnet-4-6' })}
          >
            <Bot size={15} /> Agente
          </button>
          <button
            className="ui-btn"
            style={{ background: 'rgba(99, 102, 241, 0.2)', borderColor: 'rgba(99, 102, 241, 0.5)' }}
            onClick={() => {
              const name = window.prompt('Nome da Entidade (ex: TechLead, Backend, QA):')?.trim();
              if (!name) return;
              const folderName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
              const color = ENTITY_COLORS[Math.floor(Math.random() * ENTITY_COLORS.length)];
              addNode('entity', { entityName: name, folderName, color });
            }}
          >
            <Users size={15} /> Entidade
          </button>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          deleteKeyCode={['Delete', 'Backspace']}
          fitView
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#2a2d35" />
          <Controls style={{ backgroundColor: 'rgba(30, 33, 40, 0.8)', border: '1px solid rgba(255,255,255,0.1)' }} />
          <MiniMap
            style={{ backgroundColor: 'rgba(15, 17, 21, 0.9)', border: '1px solid rgba(255,255,255,0.1)' }}
            nodeColor={n => {
              switch (n.type) {
                case 'terminal': return '#3b82f6';
                case 'note': return '#10b981';
                case 'agent': return '#8b5cf6';
                case 'text': return '#fde047';
                default: return '#f59e0b';
              }
            }}
            maskColor="rgba(0,0,0,0.4)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

// ── Auth gate ─────────────────────────────────────────────────────────────────

function AuthGate() {
  const [status, setStatus] = useState<'checking' | 'anon' | 'authed'>('checking');
  const [username, setUsername] = useState('');

  useEffect(() => {
    me().then(user => {
      if (user) {
        setUsername(user.username);
        setStatus('authed');
      } else {
        setStatus('anon');
      }
    });
  }, []);

  const handleLoginSuccess = async () => {
    const user = await me();
    if (user) {
      setUsername(user.username);
      setStatus('authed');
    }
  };

  if (status === 'checking') {
    return <div style={{ color: 'white', padding: 20, background: '#0f1115', height: '100vh' }}>Carregando...</div>;
  }

  if (status === 'anon') {
    return <LoginPage onSuccess={handleLoginSuccess} />;
  }

  return <Canvas username={username} onLogout={() => setStatus('anon')} />;
}

export default AuthGate;
