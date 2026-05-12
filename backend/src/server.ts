import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import * as os from 'os';
import * as pty from 'node-pty';
import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'MISSING_KEY',
});

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

const vaultPath = path.resolve(__dirname, '../../vault');
const projectRoot = path.resolve(__dirname, '../../');

if (!fs.existsSync(vaultPath)) {
  fs.mkdirSync(vaultPath, { recursive: true });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function layoutFilePath(workspace?: string): string {
  if (!workspace || workspace === 'default') return path.join(projectRoot, 'layout.json');
  const safe = workspace.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(projectRoot, `layout-${safe}.json`);
}

function getDirectoryTree(dirPath: string): any {
  const name = path.basename(dirPath);
  const item: any = { name, path: dirPath, type: 'directory', children: [] };
  try {
    for (const file of fs.readdirSync(dirPath)) {
      if (file.startsWith('.') || file === 'node_modules') continue;
      const fullPath = path.join(dirPath, file);
      if (fs.statSync(fullPath).isDirectory()) {
        item.children.push(getDirectoryTree(fullPath));
      } else {
        item.children.push({ name: file, path: fullPath, type: 'file' });
      }
    }
  } catch {}
  return item;
}

// ── Vault ─────────────────────────────────────────────────────────────────────

app.get('/api/vault/files', (_req, res) => {
  try {
    const files = fs.readdirSync(vaultPath).filter(f => f.endsWith('.md'));
    res.json(files);
  } catch {
    res.status(500).json({ error: 'Failed to read vault' });
  }
});

app.get('/api/vault/files/:filename', (req, res) => {
  const { filename } = req.params;
  if (!filename.endsWith('.md')) return res.status(400).json({ error: 'Only .md files allowed' });
  const filePath = path.join(vaultPath, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.send(fs.readFileSync(filePath, 'utf-8'));
});

app.post('/api/vault/files/:filename', (req, res) => {
  const { filename } = req.params;
  if (!filename.endsWith('.md')) return res.status(400).json({ error: 'Only .md files allowed' });
  fs.writeFileSync(path.join(vaultPath, filename), req.body.content || '', 'utf-8');
  res.json({ success: true });
});

// ── Workspace tree ────────────────────────────────────────────────────────────

app.get('/api/workspace/tree', (_req, res) => {
  try {
    res.json(getDirectoryTree(projectRoot));
  } catch {
    res.status(500).json({ error: 'Failed to read tree' });
  }
});

// ── Layout (workspace-aware) ──────────────────────────────────────────────────

app.get('/api/layout', (req, res) => {
  const filePath = layoutFilePath(req.query.workspace as string);
  try {
    if (fs.existsSync(filePath)) {
      res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    } else {
      res.json(null);
    }
  } catch {
    res.status(500).json({ error: 'Failed to read layout' });
  }
});

app.post('/api/layout', (req, res) => {
  const filePath = layoutFilePath(req.query.workspace as string);
  try {
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to save layout' });
  }
});

// ── Workspaces list / delete ──────────────────────────────────────────────────

app.get('/api/workspaces', (_req, res) => {
  try {
    const names: string[] = ['default'];
    for (const f of fs.readdirSync(projectRoot)) {
      const m = f.match(/^layout-(.+)\.json$/);
      if (m) names.push(m[1]);
    }
    res.json(names);
  } catch {
    res.status(500).json({ error: 'Failed to list workspaces' });
  }
});

app.delete('/api/workspace/:name', (req, res) => {
  const { name } = req.params;
  if (name === 'default') return res.status(400).json({ error: 'Cannot delete default workspace' });
  const filePath = layoutFilePath(name);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete workspace' });
  }
});

// ── Agent (streaming SSE) ─────────────────────────────────────────────────────

app.post('/api/run-agent-stream', async (req, res) => {
  const { inputFiles, outputFile, systemPrompt, model } = req.body as {
    inputFiles: string[];
    outputFile: string;
    systemPrompt?: string;
    model?: string;
  };

  if (!inputFiles?.length || !outputFile) {
    return res.status(400).json({ error: 'inputFiles and outputFile are required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (payload: object) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    let inputContent = '';
    for (const f of inputFiles) {
      const p = path.join(vaultPath, f);
      if (fs.existsSync(p)) {
        inputContent += `### ${f}\n\n${fs.readFileSync(p, 'utf-8')}\n\n---\n\n`;
      }
    }

    if (!inputContent.trim()) {
      send({ error: 'Input file(s) empty or not found' });
      return res.end();
    }

    const stream = anthropic.messages.stream({
      model: model || 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt || 'You are a helpful assistant.',
      messages: [{
        role: 'user',
        content: `Abaixo está o documento base para a sua tarefa:\n\n${inputContent}\nPor favor, execute a tarefa solicitada com base nesse texto.`,
      }],
    });

    let fullText = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullText += event.delta.text;
        send({ text: event.delta.text });
      }
    }

    fs.writeFileSync(path.join(vaultPath, outputFile), fullText, 'utf-8');
    send({ done: true });
  } catch (err: any) {
    console.error('Streaming agent failed:', err);
    send({ error: err.message });
  }

  res.end();
});

// ── Legacy non-streaming endpoint (kept for compatibility) ────────────────────

app.post('/api/run-agent', async (req, res) => {
  try {
    const { inputFile, outputFile, systemPrompt } = req.body;
    if (!inputFile || !outputFile) return res.status(400).json({ error: 'inputFile and outputFile required' });

    const inputPath = path.join(vaultPath, inputFile);
    if (!fs.existsSync(inputPath)) return res.status(404).json({ error: `Input not found: ${inputFile}` });

    const inputContent = fs.readFileSync(inputPath, 'utf-8');
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt || 'You are a helpful assistant.',
      messages: [{ role: 'user', content: inputContent }],
    });

    const textBlock = msg.content.find(b => b.type === 'text');
    const textoFinal = textBlock?.text ?? '';
    fs.writeFileSync(path.join(vaultPath, outputFile), textoFinal, 'utf-8');
    res.json({ success: true, outputFile });
  } catch (err: any) {
    res.status(500).json({ error: 'Agent failed', details: err.message });
  }
});

// ── HTTP + WebSocket server ───────────────────────────────────────────────────

const server = app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  console.log('Terminal connected');
  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: process.env.USERPROFILE || process.cwd(),
    env: process.env as Record<string, string>,
  });

  ptyProcess.onData((data) => ws.send(data));
  ws.on('message', (msg) => ptyProcess.write(msg.toString()));
  ws.on('close', () => {
    console.log('Terminal disconnected');
    ptyProcess.kill();
  });
  ws.on('error', () => ptyProcess.kill());
});
