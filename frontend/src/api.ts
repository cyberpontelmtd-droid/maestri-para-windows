export const API_BASE = 'http://localhost:3001/api/vault';
export const API_ROOT = 'http://localhost:3001/api';

// ── Vault ──────────────────────────────────────────────────────────────────────

export async function fetchFiles(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/files`);
  if (!res.ok) throw new Error('Failed to fetch files');
  return res.json();
}

export async function readFile(filename: string): Promise<string> {
  const res = await fetch(`${API_BASE}/files/${encodeURIComponent(filename)}`);
  if (!res.ok) {
    if (res.status === 404) return '';
    throw new Error('Failed to read file');
  }
  return res.text();
}

export async function saveFile(filename: string, content: string): Promise<void> {
  await fetch(`${API_BASE}/files/${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

// ── Layout (workspace-aware) ───────────────────────────────────────────────────

export async function getLayout(workspace = 'default'): Promise<any> {
  const qs = workspace !== 'default' ? `?workspace=${encodeURIComponent(workspace)}` : '';
  const res = await fetch(`${API_ROOT}/layout${qs}`);
  if (!res.ok) throw new Error('Failed to fetch layout');
  return res.json();
}

export async function saveLayout(layout: any, workspace = 'default'): Promise<void> {
  const qs = workspace !== 'default' ? `?workspace=${encodeURIComponent(workspace)}` : '';
  await fetch(`${API_ROOT}/layout${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  });
}

// ── Workspaces ─────────────────────────────────────────────────────────────────

export async function getWorkspaces(): Promise<string[]> {
  const res = await fetch(`${API_ROOT}/workspaces`);
  if (!res.ok) throw new Error('Failed to fetch workspaces');
  return res.json();
}

export async function deleteWorkspace(name: string): Promise<void> {
  await fetch(`${API_ROOT}/workspace/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// ── File tree ──────────────────────────────────────────────────────────────────

export async function getWorkspaceTree(): Promise<any> {
  const res = await fetch(`${API_ROOT}/workspace/tree`);
  if (!res.ok) throw new Error('Failed to fetch tree');
  return res.json();
}

// ── Agent streaming ────────────────────────────────────────────────────────────

export async function runAgentStream(
  inputFiles: string[],
  outputFile: string,
  systemPrompt: string,
  model: string,
  onChunk: (text: string, accumulated: string) => void,
  onDone: () => void,
  onError: (msg: string) => void,
): Promise<void> {
  const res = await fetch(`${API_ROOT}/run-agent-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputFiles, outputFile, systemPrompt, model }),
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error || 'Failed to start agent stream');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const line = part.split('\n').find(l => l.startsWith('data: '));
      if (!line) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.error) { onError(data.error); return; }
        if (data.text) {
          accumulated += data.text;
          onChunk(data.text, accumulated);
        }
        if (data.done) { onDone(); return; }
      } catch {}
    }
  }
}

// ── Legacy ─────────────────────────────────────────────────────────────────────

export async function runAgent(inputFile: string, outputFile: string, systemPrompt: string): Promise<any> {
  const res = await fetch(`${API_ROOT}/run-agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputFile, outputFile, systemPrompt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to run agent');
  }
  return res.json();
}
