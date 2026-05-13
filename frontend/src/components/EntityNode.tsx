import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  X, TerminalSquare, FileText, Bot, Plus, Save,
  RefreshCw, Play, Square, CheckCircle2, AlertCircle,
  Copy, ExternalLink, ChevronLeft, Edit2, Check, Trash2,
} from 'lucide-react';
import {
  createEntity, getEntityVaultPath,
  getBrainFiles, readBrainFile, saveBrainFile, deleteBrainFile,
  getEntityNotes, readEntityNote, saveEntityNote,
  runEntityAgentStream,
} from '../api';

type Tab = 'terminal' | 'notes' | 'brain' | 'agent';

const MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
];

export default function EntityNode({ id, data, selected }: NodeProps) {
  const { setNodes } = useReactFlow();
  const folderName = (data.folderName as string) || 'entity';
  const [entityName, setEntityName] = useState((data.entityName as string) || 'Entidade');
  const [editingName, setEditingName] = useState(false);
  const color = (data.color as string) || '#6366f1';
  const [activeTab, setActiveTab] = useState<Tab>('terminal');

  // Terminal
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  // Notes
  const [notes, setNotes] = useState<string[]>([]);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState('');
  const [editingNote, setEditingNote] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState('');

  // Brain
  const [brainFiles, setBrainFiles] = useState<string[]>([]);
  const [selectedBrainFile, setSelectedBrainFile] = useState<string | null>(null);
  const [brainFileContent, setBrainFileContent] = useState('');
  const [editingBrainFile, setEditingBrainFile] = useState(false);
  const [addingMemory, setAddingMemory] = useState(false);
  const [newMemTitle, setNewMemTitle] = useState('');
  const [newMemContent, setNewMemContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [brainPath, setBrainPath] = useState('');

  // Agent
  const [model, setModel] = useState((data.model as string) || 'claude-sonnet-4-6');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userMessage, setUserMessage] = useState('');
  const [agentOutput, setAgentOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [saveToBrain, setSaveToBrain] = useState(true);
  const [agentStatus, setAgentStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [agentError, setAgentError] = useState('');
  const agentOutputRef = useRef<HTMLDivElement>(null);

  // Create entity folder + load vault path on mount
  useEffect(() => {
    createEntity(folderName, entityName).catch(console.error);
    getEntityVaultPath(folderName).then(p => setBrainPath(p.brainPath)).catch(() => {});
  }, []);

  // Load data when tab becomes active
  useEffect(() => {
    if (activeTab === 'notes') loadNotes();
    if (activeTab === 'brain') loadBrainFiles();
    if (activeTab === 'agent' && !systemPrompt) {
      readBrainFile(folderName, '_persona.md')
        .then(c => { if (c) setSystemPrompt(c); })
        .catch(() => {});
    }
  }, [activeTab]);

  // Terminal: init once on mount with proper cleanup (handles StrictMode double-invoke)
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      theme: { background: 'rgba(10, 12, 16, 0.97)', foreground: '#e2e8f0', cursor: color },
      fontFamily: 'Consolas, monospace',
      fontSize: 13,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    const fitTimer = setTimeout(() => { try { fitAddon.fit(); } catch {} }, 60);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const ws = new WebSocket('ws://localhost:3001');
    wsRef.current = ws;
    ws.onopen = () => term.writeln(`\x1b[32m[${entityName} — Terminal conectado]\x1b[0m`);
    ws.onmessage = e => term.write(e.data);
    ws.onerror = () => term.writeln('\x1b[31m[Erro de conexão]\x1b[0m');
    ws.onclose = () => term.writeln('\x1b[31m[Desconectado]\x1b[0m');
    term.onData(d => { if (ws.readyState === WebSocket.OPEN) ws.send(d); });

    const ro = new ResizeObserver(() => { try { fitAddon.fit(); } catch {} });
    ro.observe(terminalRef.current);
    roRef.current = ro;

    return () => {
      clearTimeout(fitTimer);
      ro.disconnect();
      ws.close();
      term.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refit when switching back to terminal tab
  useEffect(() => {
    if (activeTab === 'terminal') {
      setTimeout(() => { try { fitAddonRef.current?.fit(); } catch {} }, 30);
    }
  }, [activeTab]);

  // Auto-scroll agent output
  useEffect(() => {
    if (agentOutputRef.current) {
      agentOutputRef.current.scrollTop = agentOutputRef.current.scrollHeight;
    }
  }, [agentOutput]);

  const loadNotes = useCallback(async () => {
    const files = await getEntityNotes(folderName).catch(() => []);
    setNotes(files);
  }, [folderName]);

  const loadBrainFiles = useCallback(async () => {
    const files = await getBrainFiles(folderName).catch(() => []);
    setBrainFiles(files);
  }, [folderName]);

  const openNote = useCallback(async (filename: string) => {
    const content = await readEntityNote(folderName, filename);
    setSelectedNote(filename);
    setNoteContent(content);
    setEditingNote(false);
  }, [folderName]);

  const saveNote = useCallback(async () => {
    if (!selectedNote) return;
    setSavingNote(true);
    await saveEntityNote(folderName, selectedNote, noteContent).catch(() => {});
    setSavingNote(false);
    setEditingNote(false);
  }, [folderName, selectedNote, noteContent]);

  const createNote = useCallback(async () => {
    if (!newNoteTitle.trim()) return;
    const safe = newNoteTitle.trim().replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '-');
    const filename = `${safe || 'nota'}.md`;
    await saveEntityNote(folderName, filename, `# ${newNoteTitle}\n\n`);
    setNewNoteTitle('');
    setCreatingNote(false);
    await loadNotes();
    openNote(filename);
  }, [folderName, newNoteTitle, loadNotes, openNote]);

  const openBrainFile = useCallback(async (filename: string) => {
    const content = await readBrainFile(folderName, filename);
    setSelectedBrainFile(filename);
    setBrainFileContent(content);
    setEditingBrainFile(false);
  }, [folderName]);

  const saveBrainFileContent = useCallback(async () => {
    if (!selectedBrainFile) return;
    await saveBrainFile(folderName, selectedBrainFile, brainFileContent);
    setEditingBrainFile(false);
  }, [folderName, selectedBrainFile, brainFileContent]);

  const addMemory = useCallback(async () => {
    if (!newMemContent.trim()) return;
    const title = newMemTitle.trim() || `memoria-${Date.now()}`;
    const filename = `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
    const content = newMemTitle ? `# ${newMemTitle}\n\n${newMemContent}` : newMemContent;
    await saveBrainFile(folderName, filename, content);
    setNewMemTitle('');
    setNewMemContent('');
    setAddingMemory(false);
    await loadBrainFiles();
  }, [folderName, newMemTitle, newMemContent, loadBrainFiles]);

  const removeMemory = useCallback(async (filename: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Excluir "${filename}"?`)) return;
    await deleteBrainFile(folderName, filename);
    await loadBrainFiles();
  }, [folderName, loadBrainFiles]);

  const runAgent = useCallback(async () => {
    if (!userMessage.trim() || isRunning) return;
    setIsRunning(true);
    setAgentStatus('idle');
    setAgentError('');
    setAgentOutput('');

    try {
      await runEntityAgentStream(
        folderName, userMessage, systemPrompt, model, saveToBrain,
        (_chunk, accumulated) => setAgentOutput(accumulated),
        (savedTo) => {
          setAgentStatus('success');
          if (savedTo) loadBrainFiles();
          setTimeout(() => setAgentStatus('idle'), 4000);
        },
        (msg) => { setAgentError(msg); setAgentStatus('error'); },
      );
    } catch (err: any) {
      setAgentError(err.message || 'Erro ao rodar o agente');
      setAgentStatus('error');
    } finally {
      setIsRunning(false);
    }
  }, [folderName, userMessage, systemPrompt, model, saveToBrain, loadBrainFiles]);

  const copyBrainPath = useCallback(() => {
    navigator.clipboard.writeText(brainPath || `vault\\${folderName}\\brain`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [brainPath, folderName]);

  const openInObsidian = useCallback(() => {
    // Obsidian needs a FILE path (not a folder) with forward slashes
    const base = brainPath || `vault/${folderName}/brain`;
    const personaFile = (base + '/_persona.md').replace(/\\/g, '/');
    window.open(`obsidian://open?path=${encodeURIComponent(personaFile)}`, '_blank');
  }, [brainPath, folderName]);

  const commitName = () => {
    setEditingName(false);
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, entityName } } : n));
  };

  const tab = (t: Tab): React.CSSProperties => ({
    padding: '6px 10px', background: activeTab === t ? `${color}25` : 'transparent',
    border: 'none', borderBottom: activeTab === t ? `2px solid ${color}` : '2px solid transparent',
    color: activeTab === t ? color : '#64748b', cursor: 'pointer', fontSize: 11,
    fontWeight: activeTab === t ? 600 : 400, display: 'flex', alignItems: 'center', gap: 4,
    transition: 'all 0.15s', fontFamily: 'Inter, sans-serif', flexShrink: 0, whiteSpace: 'nowrap',
  });

  return (
    <div className="glass-panel" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <NodeResizer minWidth={440} minHeight={360} isVisible={!!selected} color={color} />
      <Handle type="target" position={Position.Left} style={{ background: color, width: 10, height: 10 }} />

      {/* Header */}
      <div
        className="glass-header custom-drag-handle"
        style={{ background: `${color}20`, borderBottomColor: `${color}40`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, overflow: 'hidden' }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: `0 0 7px ${color}` }} />
          {editingName ? (
            <input
              value={entityName}
              onChange={e => setEntityName(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false); }}
              autoFocus
              style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${color}`, color: '#e2e8f0', fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 700, outline: 'none', flex: 1 }}
            />
          ) : (
            <span
              onDoubleClick={() => setEditingName(true)}
              title="Duplo-clique para renomear"
              style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}
            >
              {entityName}
            </span>
          )}
          <span style={{ fontSize: 10, color: '#475569', flexShrink: 0 }}>/{folderName}</span>
        </div>
        <button onClick={() => setNodes(nds => nds.filter(n => n.id !== id))} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', display: 'flex', padding: 0, flexShrink: 0 }}>
          <X size={14} />
        </button>
      </div>

      {/* Tab Bar */}
      <div className="nodrag" style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.2)', overflowX: 'auto', flexShrink: 0 }}>
        <button style={tab('terminal')} onClick={() => setActiveTab('terminal')}>
          <TerminalSquare size={12} /> Terminal
        </button>
        <button style={tab('notes')} onClick={() => setActiveTab('notes')}>
          <FileText size={12} /> Notas
        </button>
        <button style={tab('brain')} onClick={() => setActiveTab('brain')}>
          🧠 Cérebro
        </button>
        <button style={tab('agent')} onClick={() => setActiveTab('agent')}>
          <Bot size={12} /> Agente
        </button>
      </div>

      {/* Content */}
      <div className="nodrag" style={{ flex: 1, overflow: 'hidden', minHeight: 0, position: 'relative' }}>

        {/* Terminal — always in DOM with real dimensions; opacity hides it when inactive */}
        <div style={{
          position: 'absolute', inset: 0, padding: 6,
          opacity: activeTab === 'terminal' ? 1 : 0,
          pointerEvents: activeTab === 'terminal' ? 'all' : 'none',
          zIndex: activeTab === 'terminal' ? 1 : 0,
        }}>
          <div ref={terminalRef} style={{ width: '100%', height: '100%' }} />
        </div>

        {/* Notes */}
        {activeTab === 'notes' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {!selectedNote ? (
              <div style={{ flex: 1, padding: 12, overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Notas ({notes.length})</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={loadNotes} style={iconBtn} title="Recarregar"><RefreshCw size={12} /></button>
                    <button onClick={() => setCreatingNote(true)} style={{ ...iconBtn, color: color }} title="Nova nota"><Plus size={12} /></button>
                  </div>
                </div>

                {creatingNote && (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    <input value={newNoteTitle} onChange={e => setNewNoteTitle(e.target.value)} placeholder="Nome da nota..." autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') createNote(); if (e.key === 'Escape') setCreatingNote(false); }}
                      style={inputSt} />
                    <button onClick={createNote} style={{ ...iconBtn, color: '#10b981' }}><Check size={12} /></button>
                    <button onClick={() => setCreatingNote(false)} style={iconBtn}><X size={12} /></button>
                  </div>
                )}

                {notes.length === 0 && !creatingNote && (
                  <p style={{ color: '#334155', fontSize: 12, fontStyle: 'italic' }}>Nenhuma nota. Clique em + para criar.</p>
                )}

                {notes.map(f => (
                  <div key={f} onClick={() => openNote(f)} style={fileItem}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}>
                    📝 {f.replace('.md', '')}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <button onClick={() => setSelectedNote(null)} style={iconBtn}><ChevronLeft size={14} /></button>
                  <span style={{ fontSize: 12, color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedNote.replace('.md', '')}</span>
                  {!editingNote
                    ? <button onClick={() => setEditingNote(true)} style={iconBtn}><Edit2 size={12} /></button>
                    : <button onClick={saveNote} disabled={savingNote} style={{ ...iconBtn, color: '#10b981' }}><Check size={12} /></button>}
                </div>
                <div style={{ flex: 1, padding: 12, overflowY: 'auto' }}>
                  {editingNote
                    ? <textarea value={noteContent} onChange={e => setNoteContent(e.target.value)} style={{ ...textareaSt, height: '100%', minHeight: 180 }} />
                    : <div style={mdSt}><ReactMarkdown remarkPlugins={[remarkGfm]}>{noteContent || '*Nota vazia...*'}</ReactMarkdown></div>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Brain */}
        {activeTab === 'brain' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {!selectedBrainFile ? (
              <div style={{ flex: 1, padding: 12, overflowY: 'auto' }}>
                {/* Obsidian card */}
                <div style={{ padding: '10px 12px', marginBottom: 12, background: `${color}12`, border: `1px solid ${color}30`, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: color, fontWeight: 700, marginBottom: 4 }}>🧠 Cérebro Ativo — Vault Obsidian</div>
                  <div style={{ fontSize: 10, color: '#475569', marginBottom: 8, wordBreak: 'break-all', fontFamily: 'Consolas, monospace' }}>
                    {brainPath || `vault\\${folderName}\\brain`}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={copyBrainPath} style={{ ...smallBtn, color: copied ? '#10b981' : '#94a3b8' }}>
                      <Copy size={11} /> {copied ? 'Copiado!' : 'Copiar Caminho'}
                    </button>
                    <button onClick={openInObsidian} style={{ ...smallBtn, color: '#a78bfa' }}>
                      <ExternalLink size={11} /> Abrir no Obsidian
                    </button>
                  </div>
                </div>

                {/* Files list */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Memórias ({brainFiles.length})</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={loadBrainFiles} style={iconBtn} title="Recarregar"><RefreshCw size={12} /></button>
                    <button onClick={() => setAddingMemory(true)} style={{ ...iconBtn, color: color }} title="Nova memória"><Plus size={12} /></button>
                  </div>
                </div>

                {addingMemory && (
                  <div style={{ marginBottom: 12, padding: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }}>
                    <input value={newMemTitle} onChange={e => setNewMemTitle(e.target.value)} placeholder="Título (opcional)" style={{ ...inputSt, marginBottom: 6 }} />
                    <textarea value={newMemContent} onChange={e => setNewMemContent(e.target.value)} placeholder="Conhecimento a salvar no cérebro..." rows={4} style={{ ...textareaSt, marginBottom: 6 }} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={addMemory} style={{ ...smallBtn, color: '#10b981', background: 'rgba(16,185,129,0.1)' }}>
                        <Save size={11} /> Salvar
                      </button>
                      <button onClick={() => { setAddingMemory(false); setNewMemTitle(''); setNewMemContent(''); }} style={smallBtn}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {brainFiles.map(f => (
                  <div key={f} onClick={() => openBrainFile(f)}
                    style={{ ...fileItem, background: f === '_persona.md' ? `${color}12` : 'rgba(255,255,255,0.04)', border: `1px solid ${f === '_persona.md' ? color + '30' : 'rgba(255,255,255,0.06)'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.09)')}
                    onMouseLeave={e => (e.currentTarget.style.background = f === '_persona.md' ? `${color}12` : 'rgba(255,255,255,0.04)')}>
                    <span>{f === '_persona.md' ? '🎭' : '🧠'} {f.replace('.md', '')}</span>
                    {f !== '_persona.md' && (
                      <button onClick={e => removeMemory(f, e)} style={{ ...iconBtn, color: '#ef4444', opacity: 0.6, padding: 2 }} title="Excluir">
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <button onClick={() => setSelectedBrainFile(null)} style={iconBtn}><ChevronLeft size={14} /></button>
                  <span style={{ fontSize: 12, color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>🧠 {selectedBrainFile.replace('.md', '')}</span>
                  {!editingBrainFile
                    ? <button onClick={() => setEditingBrainFile(true)} style={iconBtn}><Edit2 size={12} /></button>
                    : <button onClick={saveBrainFileContent} style={{ ...iconBtn, color: '#10b981' }}><Check size={12} /></button>}
                </div>
                <div style={{ flex: 1, padding: 12, overflowY: 'auto' }}>
                  {editingBrainFile
                    ? <textarea value={brainFileContent} onChange={e => setBrainFileContent(e.target.value)} style={{ ...textareaSt, height: '100%', minHeight: 180 }} />
                    : <div style={mdSt}><ReactMarkdown remarkPlugins={[remarkGfm]}>{brainFileContent || '*Arquivo vazio...*'}</ReactMarkdown></div>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Agent */}
        {activeTab === 'agent' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Config */}
            <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={labelSt}>Modelo</label>
                  <select value={model} onChange={e => setModel(e.target.value)} style={selectSt}>
                    {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, color: '#64748b', paddingBottom: 6, whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={saveToBrain} onChange={e => setSaveToBrain(e.target.checked)} style={{ cursor: 'pointer', accentColor: color }} />
                  🧠 Salvar no Cérebro
                </label>
              </div>
              <label style={labelSt}>Persona / System Prompt</label>
              <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} placeholder="Instruções e persona..." rows={2}
                style={{ ...textareaSt, border: `1px solid ${color}30` }} />
            </div>

            {/* Output */}
            <div ref={agentOutputRef} style={{ flex: 1, padding: 12, overflowY: 'auto', minHeight: 0 }}>
              {agentOutput ? (
                <>
                  <div style={mdSt}><ReactMarkdown remarkPlugins={[remarkGfm]}>{agentOutput}</ReactMarkdown></div>
                  {isRunning && <span className="streaming-cursor" />}
                </>
              ) : (
                <div style={{ color: '#334155', fontSize: 12, fontStyle: 'italic', textAlign: 'center', marginTop: 24 }}>
                  {isRunning ? 'Gerando resposta...' : 'A resposta aparecerá aqui'}
                </div>
              )}
              {agentStatus === 'success' && (
                <div style={{ color: '#10b981', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
                  <CheckCircle2 size={12} /> {saveToBrain ? 'Salvo no Cérebro!' : 'Concluído!'}
                </div>
              )}
              {agentStatus === 'error' && (
                <div style={{ color: '#ef4444', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
                  <AlertCircle size={12} /> {agentError}
                </div>
              )}
            </div>

            {/* Input */}
            <div style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <textarea value={userMessage} onChange={e => setUserMessage(e.target.value)}
                  placeholder="Digite sua mensagem... (Ctrl+Enter para enviar)"
                  rows={2}
                  onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) runAgent(); }}
                  style={{ flex: 1, ...textareaSt, resize: 'none' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button onClick={runAgent} disabled={isRunning || !userMessage.trim()}
                    style={{ padding: '8px 12px', background: isRunning ? `${color}55` : color, color: 'white', border: 'none', borderRadius: 6, cursor: isRunning || !userMessage.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, opacity: !userMessage.trim() ? 0.5 : 1 }}>
                    {isRunning ? <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚙️</span> : <Play size={13} />}
                  </button>
                  {isRunning && (
                    <button onClick={() => setIsRunning(false)}
                      style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                      <Square size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} style={{ background: color, width: 10, height: 10 }} />
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#64748b',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 3,
};

const smallBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
  color: '#94a3b8', borderRadius: 4, cursor: 'pointer', padding: '4px 8px',
  fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'Inter, sans-serif',
};

const fileItem: React.CSSProperties = {
  padding: '7px 10px', marginBottom: 5,
  background: 'rgba(255,255,255,0.04)', borderRadius: 6, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.06)', fontSize: 12, color: '#cbd5e1',
  transition: 'background 0.12s',
};

const inputSt: React.CSSProperties = {
  width: '100%', background: 'rgba(0,0,0,0.25)',
  border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0',
  fontFamily: 'Inter, sans-serif', fontSize: 12, padding: '6px 8px', borderRadius: 6,
};

const textareaSt: React.CSSProperties = {
  width: '100%', background: 'rgba(0,0,0,0.25)',
  border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0',
  fontFamily: 'Inter, sans-serif', fontSize: 12, padding: '6px 8px', borderRadius: 6,
};

const mdSt: React.CSSProperties = {
  fontSize: 13, lineHeight: 1.6, color: '#cbd5e1',
};

const labelSt: React.CSSProperties = {
  display: 'block', fontSize: 10, color: '#64748b', marginBottom: 3,
};

const selectSt: React.CSSProperties = {
  width: '100%', background: 'rgba(0,0,0,0.3)',
  border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0',
  fontFamily: 'Inter, sans-serif', fontSize: 12, padding: '5px 8px',
  borderRadius: 6, cursor: 'pointer',
};
