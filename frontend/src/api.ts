export const API_BASE = '/api/vault';
export const API_ROOT = '/api';

// Todo fetch precisa mandar o cookie de sessao. `fetchJson` centraliza isso e
// trata 401 de forma consistente (o chamador decide o que fazer com o erro).
async function fetchJson(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: 'include' });
}

// ── Auth ───────────────────────────────────────────────────────────────────────

export async function login(username: string, password: string): Promise<void> {
  const res = await fetchJson(`${API_ROOT}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error || 'Login falhou');
  }
}

export async function logout(): Promise<void> {
  await fetchJson(`${API_ROOT}/auth/logout`, { method: 'POST' });
}

export async function me(): Promise<{ id: string; username: string } | null> {
  const res = await fetchJson(`${API_ROOT}/auth/me`);
  if (!res.ok) return null;
  return res.json();
}

// ── Vault ──────────────────────────────────────────────────────────────────────

export async function fetchFiles(): Promise<string[]> {
  const res = await fetchJson(`${API_BASE}/files`);
  if (!res.ok) throw new Error('Failed to fetch files');
  return res.json();
}

export async function readFile(filename: string): Promise<string> {
  const res = await fetchJson(`${API_BASE}/files/${encodeURIComponent(filename)}`);
  if (!res.ok) {
    if (res.status === 404) return '';
    throw new Error('Failed to read file');
  }
  return res.text();
}

export async function saveFile(filename: string, content: string): Promise<void> {
  await fetchJson(`${API_BASE}/files/${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

// ── Layout (workspace-aware) ───────────────────────────────────────────────────

export async function getLayout(workspace = 'default'): Promise<any> {
  const qs = workspace !== 'default' ? `?workspace=${encodeURIComponent(workspace)}` : '';
  const res = await fetchJson(`${API_ROOT}/layout${qs}`);
  if (!res.ok) throw new Error('Failed to fetch layout');
  return res.json();
}

export async function saveLayout(layout: any, workspace = 'default'): Promise<void> {
  const qs = workspace !== 'default' ? `?workspace=${encodeURIComponent(workspace)}` : '';
  await fetchJson(`${API_ROOT}/layout${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  });
}

// ── Workspaces ─────────────────────────────────────────────────────────────────

export async function getWorkspaces(): Promise<string[]> {
  const res = await fetchJson(`${API_ROOT}/workspaces`);
  if (!res.ok) throw new Error('Failed to fetch workspaces');
  return res.json();
}

export async function deleteWorkspace(name: string): Promise<void> {
  await fetchJson(`${API_ROOT}/workspace/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// ── File tree ──────────────────────────────────────────────────────────────────

export async function getWorkspaceTree(): Promise<any> {
  const res = await fetchJson(`${API_ROOT}/workspace/tree`);
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
  const res = await fetchJson(`${API_ROOT}/run-agent-stream`, {
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

// ── Entities ──────────────────────────────────────────────────────────────────

export async function createEntity(folderName: string, displayName?: string): Promise<void> {
  await fetchJson(`${API_ROOT}/entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderName, displayName }),
  });
}

export async function getEntityVaultPath(folderName: string): Promise<{ brainPath: string; vaultPath: string }> {
  const res = await fetchJson(`${API_ROOT}/entities/${encodeURIComponent(folderName)}/path`);
  if (!res.ok) return { brainPath: '', vaultPath: '' };
  return res.json();
}

export async function getBrainFiles(folderName: string): Promise<string[]> {
  const res = await fetchJson(`${API_ROOT}/entities/${encodeURIComponent(folderName)}/brain/files`);
  if (!res.ok) return [];
  return res.json();
}

export async function readBrainFile(folderName: string, filename: string): Promise<string> {
  const res = await fetchJson(`${API_ROOT}/entities/${encodeURIComponent(folderName)}/brain/${encodeURIComponent(filename)}`);
  if (!res.ok) return '';
  return res.text();
}

export async function saveBrainFile(folderName: string, filename: string, content: string): Promise<void> {
  await fetchJson(`${API_ROOT}/entities/${encodeURIComponent(folderName)}/brain/${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export async function deleteBrainFile(folderName: string, filename: string): Promise<void> {
  await fetchJson(`${API_ROOT}/entities/${encodeURIComponent(folderName)}/brain/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
}

export async function getEntityNotes(folderName: string): Promise<string[]> {
  const res = await fetchJson(`${API_ROOT}/entities/${encodeURIComponent(folderName)}/notes`);
  if (!res.ok) return [];
  return res.json();
}

export async function readEntityNote(folderName: string, filename: string): Promise<string> {
  const res = await fetchJson(`${API_ROOT}/entities/${encodeURIComponent(folderName)}/notes/${encodeURIComponent(filename)}`);
  if (!res.ok) return '';
  return res.text();
}

export async function saveEntityNote(folderName: string, filename: string, content: string): Promise<void> {
  await fetchJson(`${API_ROOT}/entities/${encodeURIComponent(folderName)}/notes/${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export async function runEntityAgentStream(
  folderName: string,
  message: string,
  systemPrompt: string,
  model: string,
  saveToBrain: boolean,
  onChunk: (text: string, accumulated: string) => void,
  onDone: (savedTo?: string) => void,
  onError: (msg: string) => void,
): Promise<void> {
  const res = await fetchJson(`${API_ROOT}/entities/${encodeURIComponent(folderName)}/agent-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, systemPrompt, model, saveToBrain }),
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).error || 'Failed to start entity agent stream');
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
        if (data.text) { accumulated += data.text; onChunk(data.text, accumulated); }
        if (data.done) { onDone(data.savedTo); return; }
      } catch {}
    }
  }
}

// ── Legacy ─────────────────────────────────────────────────────────────────────

export async function runAgent(inputFile: string, outputFile: string, systemPrompt: string): Promise<any> {
  const res = await fetchJson(`${API_ROOT}/run-agent`, {
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
