import React, { useState } from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Bot, Play, CheckCircle2, AlertCircle, X, Square } from 'lucide-react';
import { runAgentStream } from '../api';

const MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Rápido)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Equilibrado)' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7 (Poderoso)' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Rápido)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Poderoso)' },
  { id: 'llama3.2:3b', label: '🦙 Llama 3.2 3B (Local)' },
  { id: 'nous-hermes2', label: '🔮 Nous Hermes 2 (Local)' },
];

export default function AgentNode({ id, data, selected }: NodeProps) {
  const { setNodes, getEdges, getNodes } = useReactFlow();
  const [systemPrompt, setSystemPrompt] = useState(
    (data.systemPrompt as string) || 'Você é um agente inteligente do Maestri Windows.'
  );
  const [model, setModel] = useState((data.model as string) || 'gemini-2.0-flash');
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = React.useRef(false);

  const handleRun = async () => {
    const edges = getEdges();
    const nodes = getNodes();

    // Collect ALL input note filenames (multiple inputs supported)
    const inputEdges = edges.filter(e => e.target === id);
    const outputEdge = edges.find(e => e.source === id);

    if (!inputEdges.length || !outputEdge) {
      setErrorMsg('Conecte ao menos uma Nota de Entrada e uma Nota de Saída!');
      setStatus('error');
      return;
    }

    const inputFiles: string[] = inputEdges
      .map(e => nodes.find(n => n.id === e.source)?.data.filename as string)
      .filter(Boolean);

    const outputNode = nodes.find(n => n.id === outputEdge.target);
    const outputFile = outputNode?.data.filename as string;

    if (!inputFiles.length || !outputFile) {
      setErrorMsg('As notas conectadas precisam ter um arquivo associado.');
      setStatus('error');
      return;
    }

    const outputNodeId = outputEdge.target;

    setIsRunning(true);
    setStatus('idle');
    setErrorMsg('');
    abortRef.current = false;

    try {
      await runAgentStream(
        inputFiles,
        outputFile,
        systemPrompt,
        model,
        (_chunk, accumulated) => {
          // Dispatch streaming text to the output NoteNode via custom event
          window.dispatchEvent(
            new CustomEvent('note-stream', { detail: { nodeId: outputNodeId, text: accumulated } })
          );
        },
        () => {
          // Signal NoteNode to reload from disk
          window.dispatchEvent(
            new CustomEvent('note-done', { detail: { nodeId: outputNodeId } })
          );
          setStatus('success');
          // Persist model + systemPrompt to node data
          setNodes(nds =>
            nds.map(n =>
              n.id === id ? { ...n, data: { ...n.data, systemPrompt, model } } : n
            )
          );
          setTimeout(() => setStatus('idle'), 3000);
        },
        (msg) => {
          setErrorMsg(msg);
          setStatus('error');
        },
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao rodar o agente');
      setStatus('error');
    } finally {
      setIsRunning(false);
    }
  };

  const handleStop = () => {
    abortRef.current = true;
    setIsRunning(false);
    setStatus('idle');
  };

  return (
    <div
      className="glass-panel"
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <NodeResizer minWidth={260} minHeight={220} isVisible={!!selected} color="#8b5cf6" />
      <Handle type="target" position={Position.Left} style={{ background: '#8b5cf6', width: 10, height: 10 }} />

      <div
        className="glass-header custom-drag-handle"
        style={{
          background: 'rgba(139, 92, 246, 0.2)',
          borderBottomColor: 'rgba(139, 92, 246, 0.3)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c4b5fd' }}>
          <Bot size={16} /> Agente IA
        </span>
        <button
          onClick={() => setNodes(nds => nds.filter(n => n.id !== id))}
          style={{ background: 'none', border: 'none', color: '#c4b5fd', cursor: 'pointer', display: 'flex', padding: 0 }}
        >
          <X size={14} />
        </button>
      </div>

      <div className="nodrag" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflowY: 'auto' }}>
        {/* Model selector */}
        <div>
          <label style={labelStyle}>Modelo:</label>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            style={selectStyle}
          >
            {MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* System prompt */}
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Instruções (System Prompt):</label>
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            style={{
              width: '100%', minHeight: 70,
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              color: '#e2e8f0', fontFamily: 'Inter, sans-serif', fontSize: 12,
              padding: 8, borderRadius: 6, resize: 'vertical',
            }}
          />
        </div>

        {/* Run / Stop buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleRun}
            disabled={isRunning}
            style={{
              flex: 1, background: isRunning ? '#6d28d9' : '#8b5cf6',
              color: 'white', border: 'none', padding: '8px 12px',
              borderRadius: 6, cursor: isRunning ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              fontWeight: 500, fontSize: 13, transition: 'background 0.2s',
            }}
          >
            {isRunning
              ? <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚙️</span> Gerando...</>
              : <><Play size={13} /> Rodar</>
            }
          </button>
          {isRunning && (
            <button
              onClick={handleStop}
              style={{
                background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)',
                color: '#f87171', borderRadius: 6, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4, padding: '8px 10px', fontSize: 12,
              }}
            >
              <Square size={12} /> Parar
            </button>
          )}
        </div>

        {status === 'success' && (
          <div style={{ color: '#10b981', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <CheckCircle2 size={13} /> Concluído!
          </div>
        )}
        {status === 'error' && (
          <div style={{ color: '#ef4444', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, wordBreak: 'break-word' }}>
            <AlertCircle size={13} /> {errorMsg}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} style={{ background: '#8b5cf6', width: 10, height: 10 }} />
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4,
};
const selectStyle: React.CSSProperties = {
  width: '100%', background: 'rgba(0,0,0,0.3)',
  border: '1px solid rgba(139, 92, 246, 0.3)', color: '#e2e8f0',
  fontFamily: 'Inter, sans-serif', fontSize: 12, padding: '6px 8px',
  borderRadius: 6, cursor: 'pointer',
};
