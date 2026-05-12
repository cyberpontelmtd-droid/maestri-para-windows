import React, { useState } from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { X } from 'lucide-react';

const COLORS = [
  { bg: 'rgba(253, 224, 71, 0.15)', border: 'rgba(253, 224, 71, 0.4)', dot: '#fde047' },
  { bg: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.4)', dot: '#3b82f6' },
  { bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.4)', dot: '#10b981' },
  { bg: 'rgba(236, 72, 153, 0.15)', border: 'rgba(236, 72, 153, 0.4)', dot: '#ec4899' },
];

export default function TextNode({ id, data, selected }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [text, setText] = useState((data.text as string) || '');
  const colorIdx = (data.colorIdx as number) ?? 0;
  const color = COLORS[colorIdx] ?? COLORS[0];

  const update = (patch: Partial<{ text: string; colorIdx: number }>) => {
    setNodes(nds =>
      nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)
    );
  };

  return (
    <div
      className="glass-panel"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: color.bg,
        borderColor: color.border,
      }}
    >
      <NodeResizer minWidth={160} minHeight={100} isVisible={!!selected} color={color.dot} />
      <Handle type="target" position={Position.Left} style={{ background: color.dot }} />

      <div
        className="glass-header custom-drag-handle"
        style={{ background: 'rgba(0,0,0,0.25)', borderBottomColor: color.border }}
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {COLORS.map((c, i) => (
            <button
              key={i}
              onClick={() => update({ colorIdx: i })}
              style={{
                width: 12, height: 12, borderRadius: '50%', border: 'none',
                background: c.dot, cursor: 'pointer', padding: 0,
                outline: i === colorIdx ? `2px solid white` : 'none',
                outlineOffset: 1,
              }}
            />
          ))}
        </div>
        <button
          onClick={() => setNodes(nds => nds.filter(n => n.id !== id))}
          style={{ background: 'none', border: 'none', color: '#e2e8f0', cursor: 'pointer', display: 'flex', padding: 0 }}
        >
          <X size={14} />
        </button>
      </div>

      <div className="nodrag" style={{ flex: 1, padding: 8 }}>
        <textarea
          value={text}
          onChange={e => { setText(e.target.value); update({ text: e.target.value }); }}
          placeholder="Escreva aqui..."
          style={{
            width: '100%', height: '100%', background: 'transparent', border: 'none',
            color: '#f1f5f9', fontFamily: 'Inter, sans-serif', fontSize: 14,
            resize: 'none', outline: 'none', lineHeight: 1.6,
          }}
        />
      </div>

      <Handle type="source" position={Position.Right} style={{ background: color.dot }} />
    </div>
  );
}
