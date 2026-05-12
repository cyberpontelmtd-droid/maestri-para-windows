import React, { useEffect, useRef, useState } from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { X, TerminalSquare } from 'lucide-react';

export default function TerminalNode({ id, data, selected }: NodeProps) {
  const { setNodes } = useReactFlow();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [label, setLabel] = useState((data.label as string) || 'Terminal');
  const [editingLabel, setEditingLabel] = useState(false);
  const labelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      theme: { background: 'rgba(10, 12, 16, 0.95)', foreground: '#e2e8f0', cursor: '#3b82f6' },
      fontFamily: 'Consolas, monospace',
      fontSize: 13,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const ws = new WebSocket('ws://localhost:3001');
    wsRef.current = ws;

    ws.onopen = () => term.writeln('\x1b[32m[Maestri Windows — conectado]\x1b[0m');
    ws.onmessage = e => term.write(e.data);
    ws.onerror = () => term.writeln('\x1b[31m[Erro de conexão]\x1b[0m');
    ws.onclose = () => term.writeln('\x1b[31m[Desconectado]\x1b[0m');
    term.onData(d => { if (ws.readyState === WebSocket.OPEN) ws.send(d); });

    const ro = new ResizeObserver(() => { try { fitAddon.fit(); } catch {} });
    ro.observe(terminalRef.current);

    return () => {
      ro.disconnect();
      ws.close();
      term.dispose();
    };
  }, []);

  const commitLabel = () => {
    setEditingLabel(false);
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, label } } : n));
  };

  useEffect(() => {
    if (editingLabel) labelInputRef.current?.focus();
  }, [editingLabel]);

  return (
    <div
      className="glass-panel"
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <NodeResizer minWidth={320} minHeight={200} isVisible={!!selected} color="#3b82f6" />
      <Handle type="target" position={Position.Left} style={{ background: '#3b82f6' }} />

      <div className="glass-header custom-drag-handle">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, overflow: 'hidden' }}>
          <TerminalSquare size={14} color="#3b82f6" />
          {editingLabel ? (
            <input
              ref={labelInputRef}
              value={label}
              onChange={e => setLabel(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditingLabel(false); }}
              style={{
                background: 'transparent', border: 'none', borderBottom: '1px solid #3b82f6',
                color: '#e2e8f0', fontFamily: 'Inter, sans-serif', fontSize: 14,
                fontWeight: 600, outline: 'none', width: '100%',
              }}
            />
          ) : (
            <span
              onDoubleClick={() => setEditingLabel(true)}
              title="Duplo-clique para renomear"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}
            >
              {label}
            </span>
          )}
        </span>
        <button
          onClick={() => setNodes(nds => nds.filter(n => n.id !== id))}
          style={{ background: 'none', border: 'none', color: '#e2e8f0', cursor: 'pointer', display: 'flex', padding: 0, flexShrink: 0 }}
        >
          <X size={14} />
        </button>
      </div>

      <div className="nodrag" style={{ flex: 1, padding: 6, overflow: 'hidden', minHeight: 0 }}>
        <div ref={terminalRef} style={{ width: '100%', height: '100%' }} />
      </div>

      <Handle type="source" position={Position.Right} style={{ background: '#3b82f6' }} />
    </div>
  );
}
