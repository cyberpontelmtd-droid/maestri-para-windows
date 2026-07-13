import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { WebSocketServer, WebSocket } from 'ws';
import * as os from 'os';
import * as pty from 'node-pty';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import ollama from 'ollama';
import dotenv from 'dotenv';
import { pool, migrate } from './db';
import {
  verifyPassword,
  createSession,
  destroySession,
  validateSessionToken,
  parseCookies,
  getSessionCookieName,
  requireAuth,
} from './auth';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'MISSING_KEY',
});

const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'MISSING_KEY');

// Unified streaming generator: routes to Gemini, Claude, or Ollama based on model name
async function* streamText(
  model: string,
  systemPrompt: string,
  userContent: string,
): AsyncGenerator<string> {
  if (model.startsWith('gemini-')) {
    const gModel = gemini.getGenerativeModel({ model, systemInstruction: systemPrompt || undefined });
    const result = await gModel.generateContentStream(userContent);
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
  } else if (model.startsWith('claude-')) {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  } else {
    // Ollama local model
    const messages: { role: string; content: string }[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userContent });
    const response = await ollama.chat({ model, messages: messages as any, stream: true, options: { num_gpu: 0 } });
    for await (const part of response) {
      if (part.message?.content) yield part.message.content;
    }
  }
}

const app = express();
const port = 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

const appRoot = path.resolve(__dirname, '../../');
const dataRoot = path.join(appRoot, 'data');

if (!fs.existsSync(dataRoot)) {
  fs.mkdirSync(dataRoot, { recursive: true });
}

// ── Helpers: dados isolados por usuario ────────────────────────────────────────

function userDataRoot(userId: string): string {
  return path.join(dataRoot, userId);
}

function userVaultPath(userId: string): string {
  return path.join(userDataRoot(userId), 'vault');
}

function userWorkspacesPath(userId: string): string {
  return path.join(userDataRoot(userId), 'workspaces');
}

function userFilesPath(userId: string): string {
  return path.join(userDataRoot(userId), 'files');
}

function userLogsPath(userId: string): string {
  return path.join(userDataRoot(userId), 'logs');
}

function ensureUserDirs(userId: string): void {
  for (const dir of [userVaultPath(userId), userWorkspacesPath(userId), userFilesPath(userId), userLogsPath(userId)]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function layoutFilePath(userId: string, workspace?: string): string {
  const name = !workspace || workspace === 'default' ? 'default' : workspace.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(userWorkspacesPath(userId), `layout-${name}.json`);
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

// ── Auth ─────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const result = await pool.query('SELECT id, password_hash FROM users WHERE username = $1', [username]);
  if (result.rowCount === 0) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await verifyPassword(password, result.rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const userId = result.rows[0].id as string;
  const { token, expiresAt } = await createSession(userId);
  ensureUserDirs(userId);

  res.cookie(getSessionCookieName(), token, {
    httpOnly: true,
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
  res.json({ success: true });
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.cookies?.[getSessionCookieName()];
  if (token) await destroySession(token);
  res.clearCookie(getSessionCookieName(), { path: '/' });
  res.json({ success: true });
});

app.get('/api/auth/me', async (req, res) => {
  const userId = await validateSessionToken(req.cookies?.[getSessionCookieName()]);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const result = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
  res.json({ id: userId, username: result.rows[0]?.username });
});

// Tudo abaixo desta linha exige sessao valida (req.userId disponivel).
app.use('/api', requireAuth);

// ── Vault ─────────────────────────────────────────────────────────────────────

app.get('/api/vault/files', (req, res) => {
  try {
    const files = fs.readdirSync(userVaultPath(req.userId!)).filter(f => f.endsWith('.md'));
    res.json(files);
  } catch {
    res.status(500).json({ error: 'Failed to read vault' });
  }
});

app.get('/api/vault/files/:filename', (req, res) => {
  const { filename } = req.params;
  if (!filename.endsWith('.md')) return res.status(400).json({ error: 'Only .md files allowed' });
  const filePath = path.join(userVaultPath(req.userId!), filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.send(fs.readFileSync(filePath, 'utf-8'));
});

app.post('/api/vault/files/:filename', (req, res) => {
  const { filename } = req.params;
  if (!filename.endsWith('.md')) return res.status(400).json({ error: 'Only .md files allowed' });
  fs.writeFileSync(path.join(userVaultPath(req.userId!), filename), req.body.content || '', 'utf-8');
  res.json({ success: true });
});

// ── Workspace tree ────────────────────────────────────────────────────────────

app.get('/api/workspace/tree', (req, res) => {
  try {
    res.json(getDirectoryTree(userFilesPath(req.userId!)));
  } catch {
    res.status(500).json({ error: 'Failed to read tree' });
  }
});

// ── Layout (workspace-aware) ──────────────────────────────────────────────────

app.get('/api/layout', (req, res) => {
  const filePath = layoutFilePath(req.userId!, req.query.workspace as string);
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
  const filePath = layoutFilePath(req.userId!, req.query.workspace as string);
  try {
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to save layout' });
  }
});

// ── Workspaces list / delete ──────────────────────────────────────────────────

app.get('/api/workspaces', (req, res) => {
  try {
    const names: string[] = ['default'];
    for (const f of fs.readdirSync(userWorkspacesPath(req.userId!))) {
      const m = f.match(/^layout-(.+)\.json$/);
      if (m && m[1] !== 'default') names.push(m[1]);
    }
    res.json(names);
  } catch {
    res.status(500).json({ error: 'Failed to list workspaces' });
  }
});

app.delete('/api/workspace/:name', (req, res) => {
  const { name } = req.params;
  if (name === 'default') return res.status(400).json({ error: 'Cannot delete default workspace' });
  const filePath = layoutFilePath(req.userId!, name);
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
    const vaultPath = userVaultPath(req.userId!);
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

    const userContent = `Abaixo está o documento base para a sua tarefa:\n\n${inputContent}\nPor favor, execute a tarefa solicitada com base nesse texto.`;

    let fullText = '';
    for await (const chunk of streamText(model || 'claude-sonnet-4-6', systemPrompt || 'You are a helpful assistant.', userContent)) {
      fullText += chunk;
      send({ text: chunk });
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

    const vaultPath = userVaultPath(req.userId!);
    const inputPath = path.join(vaultPath, inputFile);
    if (!fs.existsSync(inputPath)) return res.status(404).json({ error: `Input not found: ${inputFile}` });

    const inputContent = fs.readFileSync(inputPath, 'utf-8');
    let textoFinal = '';
    for await (const chunk of streamText('claude-sonnet-4-6', systemPrompt || 'You are a helpful assistant.', inputContent)) {
      textoFinal += chunk;
    }
    fs.writeFileSync(path.join(vaultPath, outputFile), textoFinal, 'utf-8');
    res.json({ success: true, outputFile });
  } catch (err: any) {
    res.status(500).json({ error: 'Agent failed', details: err.message });
  }
});

// ── Entities ──────────────────────────────────────────────────────────────────

app.post('/api/entities', (req, res) => {
  const { folderName, displayName } = req.body;
  if (!folderName) return res.status(400).json({ error: 'folderName required' });
  const safe = (folderName as string).replace(/[^a-zA-Z0-9_-]/g, '_');
  const entityPath = path.join(userVaultPath(req.userId!), safe);
  const brainPath = path.join(entityPath, 'brain');
  if (!fs.existsSync(entityPath)) {
    fs.mkdirSync(entityPath, { recursive: true });
    fs.mkdirSync(brainPath, { recursive: true });
    const name = displayName || folderName;
    fs.writeFileSync(
      path.join(brainPath, '_persona.md'),
      `# ${name}\n\n## Papel\nDescreva aqui o papel e responsabilidades de ${name}.\n\n## Especialidades\n- \n\n## Estilo de trabalho\n- \n`,
      'utf-8',
    );
  }
  res.json({ success: true, folderName: safe });
});

app.get('/api/entities/:name/path', (req, res) => {
  const vaultPath = userVaultPath(req.userId!);
  const entityPath = path.join(vaultPath, req.params.name);
  res.json({ brainPath: path.join(entityPath, 'brain'), vaultPath });
});

app.get('/api/entities/:name/brain/files', (req, res) => {
  const brainPath = path.join(userVaultPath(req.userId!), req.params.name, 'brain');
  try {
    const files = fs.existsSync(brainPath)
      ? fs.readdirSync(brainPath).filter(f => f.endsWith('.md'))
      : [];
    res.json(files);
  } catch {
    res.status(500).json({ error: 'Failed to list brain files' });
  }
});

app.get('/api/entities/:name/brain/:file', (req, res) => {
  const { name, file } = req.params;
  if (!file.endsWith('.md')) return res.status(400).json({ error: 'Only .md files' });
  const filePath = path.join(userVaultPath(req.userId!), name, 'brain', file);
  if (!fs.existsSync(filePath)) return res.status(404).send('');
  res.send(fs.readFileSync(filePath, 'utf-8'));
});

app.post('/api/entities/:name/brain/:file', (req, res) => {
  const { name, file } = req.params;
  if (!file.endsWith('.md')) return res.status(400).json({ error: 'Only .md files' });
  const brainPath = path.join(userVaultPath(req.userId!), name, 'brain');
  if (!fs.existsSync(brainPath)) fs.mkdirSync(brainPath, { recursive: true });
  fs.writeFileSync(path.join(brainPath, file), req.body.content || '', 'utf-8');
  res.json({ success: true });
});

app.delete('/api/entities/:name/brain/:file', (req, res) => {
  const { name, file } = req.params;
  if (!file.endsWith('.md')) return res.status(400).json({ error: 'Only .md files' });
  const filePath = path.join(userVaultPath(req.userId!), name, 'brain', file);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ success: true });
});

app.get('/api/entities/:name/notes', (req, res) => {
  const entityPath = path.join(userVaultPath(req.userId!), req.params.name);
  try {
    const files = fs.existsSync(entityPath)
      ? fs.readdirSync(entityPath).filter(f => {
          const fp = path.join(entityPath, f);
          return f.endsWith('.md') && !fs.statSync(fp).isDirectory();
        })
      : [];
    res.json(files);
  } catch {
    res.status(500).json({ error: 'Failed to list entity notes' });
  }
});

app.get('/api/entities/:name/notes/:file', (req, res) => {
  const { name, file } = req.params;
  if (!file.endsWith('.md')) return res.status(400).json({ error: 'Only .md files' });
  const filePath = path.join(userVaultPath(req.userId!), name, file);
  if (!fs.existsSync(filePath)) return res.status(404).send('');
  res.send(fs.readFileSync(filePath, 'utf-8'));
});

app.post('/api/entities/:name/notes/:file', (req, res) => {
  const { name, file } = req.params;
  if (!file.endsWith('.md')) return res.status(400).json({ error: 'Only .md files' });
  const entityPath = path.join(userVaultPath(req.userId!), name);
  if (!fs.existsSync(entityPath)) fs.mkdirSync(entityPath, { recursive: true });
  fs.writeFileSync(path.join(entityPath, file), req.body.content || '', 'utf-8');
  res.json({ success: true });
});

app.post('/api/entities/:name/agent-stream', async (req, res) => {
  const { name } = req.params;
  const { message, systemPrompt, model, saveToBrain } = req.body as {
    message: string; systemPrompt?: string; model?: string; saveToBrain?: boolean;
  };

  if (!message?.trim()) return res.status(400).json({ error: 'message required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (payload: object) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    const brainPath = path.join(userVaultPath(req.userId!), name, 'brain');
    let brainContext = '';
    if (fs.existsSync(brainPath)) {
      for (const f of fs.readdirSync(brainPath).filter(f => f.endsWith('.md'))) {
        brainContext += `### ${f}\n\n${fs.readFileSync(path.join(brainPath, f), 'utf-8')}\n\n---\n\n`;
      }
    }

    const finalSystem = brainContext
      ? `${systemPrompt || 'Você é um agente inteligente.'}\n\n---\n## Seu Cérebro (memória e conhecimentos):\n\n${brainContext}`
      : (systemPrompt || 'Você é um agente inteligente.');

    let fullText = '';
    for await (const chunk of streamText(model || 'claude-sonnet-4-6', finalSystem, message)) {
      fullText += chunk;
      send({ text: chunk });
    }

    let savedTo: string | null = null;
    if (saveToBrain && fullText) {
      if (!fs.existsSync(brainPath)) fs.mkdirSync(brainPath, { recursive: true });
      const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
      savedTo = `memoria-${ts}.md`;
      fs.writeFileSync(
        path.join(brainPath, savedTo),
        `# Memória ${new Date().toLocaleDateString('pt-BR')}\n\n## Pergunta\n${message}\n\n## Resposta\n${fullText}`,
        'utf-8',
      );
    }

    send({ done: true, savedTo });
  } catch (err: any) {
    console.error('Entity agent stream error:', err);
    send({ error: err.message });
  }

  res.end();
});

// ── Frontend estático (produção) ──────────────────────────────────────────────

const frontendDist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.use((_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// ── HTTP + WebSocket server ───────────────────────────────────────────────────

migrate()
  .then(() => {
    const server = app.listen(port, () => {
      console.log(`Backend server listening at http://localhost:${port}`);
    });

    const wss = new WebSocketServer({ server });

    wss.on('connection', async (ws: WebSocket, req) => {
      const cookies = parseCookies(req.headers.cookie);
      const userId = await validateSessionToken(cookies[getSessionCookieName()]);
      if (!userId) {
        ws.close(4001, 'Unauthorized');
        return;
      }

      ensureUserDirs(userId);
      console.log('Terminal connected', userId);

      const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: userFilesPath(userId),
        env: process.env as Record<string, string>,
      });

      const terminalSessionId = crypto.randomUUID();
      const logPath = path.join(userLogsPath(userId), `${terminalSessionId}.log`);
      const logStream = fs.createWriteStream(logPath, { flags: 'a' });
      await pool.query(
        'INSERT INTO terminal_sessions (id, user_id, log_path) VALUES ($1, $2, $3)',
        [terminalSessionId, userId, logPath],
      );

      ptyProcess.onData((data) => {
        ws.send(data);
        logStream.write(data);
      });
      ws.on('message', (msg) => {
        const text = msg.toString();
        ptyProcess.write(text);
        logStream.write(`\n[INPUT] ${text}`);
      });
      ws.on('close', async () => {
        console.log('Terminal disconnected', userId);
        ptyProcess.kill();
        logStream.end();
        await pool.query('UPDATE terminal_sessions SET ended_at = now() WHERE id = $1', [terminalSessionId]);
      });
      ws.on('error', () => ptyProcess.kill());
    });
  })
  .catch((err) => {
    console.error('Failed to run database migrations:', err);
    process.exit(1);
  });
