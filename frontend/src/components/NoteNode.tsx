import React, { useState, useEffect, useCallback } from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Edit2, Check, X, RefreshCw } from 'lucide-react';
import { readFile, saveFile } from '../api';

export default function NoteNode({ id, data, selected }: NodeProps) {
  const { setNodes } = useReactFlow();
  const filename = (data.filename as string) || 'NovaNota.md';
  const [content, setContent] = useState((data.content as string) || '');
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  // Derived display name from first non-empty line
  const displayName = (() => {
    const first = content.split('\n').find(l => l.trim());
    if (!first) return filename;
    return first.replace(/^#+\s*/, '').trim().slice(0, 40) || filename;
  })();

  // Initial load from disk
  useEffect(() => {
    readFile(filename).then(setContent).catch(() => {});
  }, [filename]);

  // Listen for streaming chunks from AgentNode
  useEffect(() => {
    const onStream = (e: Event) => {
      const { nodeId, text } = (e as CustomEvent).detail;
      if (nodeId !== id) return;
      setIsStreaming(true);
      setContent(text);
    };
    const onDone = (e: Event) => {
      const { nodeId } = (e as CustomEvent).detail;
      if (nodeId !== id) return;
      setIsStreaming(false);
      // Re-read from disk to confirm final content
      readFile(filename).then(setContent).catch(() => {});
    };
    window.addEventListener('note-stream', onStream);
    window.addEventListener('note-done', onDone);
    return () => {
      window.removeEventListener('note-stream', onStream);
      window.removeEventListener('note-done', onDone);
    };
  }, [id, filename]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await saveFile(filename, content);
      setIsEditing(false);
    } catch {
      alert('Falha ao salvar nota.');
    } finally {
      setSaving(false);
    }
  }, [filename, content]);

  const handleReload = useCallback(() => {
    readFile(filename).then(setContent).catch(() => {});
  }, [filename]);

  return (
    <div
      className="glass-panel"
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <NodeResizer minWidth={220} minHeight={150} isVisible={!!selected} color="#10b981" />
      <Handle type="target" position={Position.Left} style={{ background: '#10b981' }} />

      <div className="glass-header custom-drag-handle">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
          <span style={{ color: '#10b981' }}>📝</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }} title={filename}>
            {displayName}
          </span>
          {isStreaming && <span className="streaming-dot" />}
        </span>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={handleReload} style={btnStyle} title="Recarregar do disco">
            <RefreshCw size={13} />
          </button>
          {!isEditing ? (
            <button onClick={() => setIsEditing(true)} style={btnStyle} title="Editar">
              <Edit2 size={13} />
            </button>
          ) : (
            <button onClick={handleSave} disabled={saving} style={{ ...btnStyle, color: '#10b981' }} title="Salvar">
              <Check size={13} />
            </button>
          )}
          <button
            onClick={() => setNodes(nds => nds.filter(n => n.id !== id))}
            style={btnStyle}
            title="Remover"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="nodrag" style={{ padding: 12, flex: 1, overflowY: 'auto' }}>
        {isEditing ? (
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            style={{
              width: '100%', height: '100%', minHeight: 120,
              background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#e2e8f0', fontFamily: 'Inter, sans-serif', fontSize: 13,
              padding: 8, borderRadius: 8, resize: 'none',
            }}
          />
        ) : (
          <div style={{ fontSize: 13, lineHeight: 1.6, color: '#cbd5e1' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content || '*Nota vazia...*'}
            </ReactMarkdown>
            {isStreaming && <span className="streaming-cursor" />}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} style={{ background: '#10b981' }} />
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: '#e2e8f0',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 2,
};
