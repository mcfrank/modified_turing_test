const express = require('express');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { Server } = require("socket.io");
const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/genai');
const { HfInference } = require('@huggingface/inference');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// 1. Serve Static Files (The React App)
// Make sure this points to where you copied the files in the Dockerfile
app.use(express.static(path.join(__dirname, 'public')));

const CONDITIONS = {
  ELIZA_VS_GEMINI: 'Eliza vs. Gemini',
  GEMINI_VS_STANFORD: 'Gemini vs. Stanford',
  BASE_VS_POSTTRAINED: 'Base vs. Post-trained',
};

const AGENTS = {
  ELIZA_CLASSIC: 'ELIZA_CLASSIC',
  GEMINI_ELIZA: 'GEMINI_ELIZA',
  GEMINI_STUDENT: 'GEMINI_STUDENT',
  REAL_STUDENT: 'REAL_STUDENT',
  OLLAMA_BASE: 'OLLAMA_BASE',
  OLLAMA_POSTTRAINED: 'OLLAMA_POSTTRAINED',
};

const sessions = new Map();

const SHEETS_ID = process.env.GOOGLE_SHEETS_ID || '';
const SHEETS_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'Sheet1!A1';
const SHEETS_ID_MASKED = SHEETS_ID ? `${SHEETS_ID.slice(0, 4)}...${SHEETS_ID.slice(-4)}` : '(missing)';
console.log(`[sheets] id=${SHEETS_ID_MASKED} range=${SHEETS_RANGE}`);
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

const getServiceAccount = () => {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
    const decoded = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
    return JSON.parse(decoded);
  }
  return null;
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_TEMPERATURE = Number.parseFloat(process.env.GEMINI_TEMPERATURE || '1.0');
const GEMINI_TOP_P = Number.parseFloat(process.env.GEMINI_TOP_P || '0.95');
const GEMINI_TOP_K = Number.parseInt(process.env.GEMINI_TOP_K || '40', 10);
const GEMINI_SEED = process.env.GEMINI_SEED ? Number.parseInt(process.env.GEMINI_SEED, 10) : undefined;
const geminiClient = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

const HF_TOKEN = process.env.HF_TOKEN || '';
const HF_BASE_MODEL = process.env.HF_BASE_MODEL || 'meta-llama/Llama-3.1-8B';
const HF_POSTTRAINED_MODEL = process.env.HF_POSTTRAINED_MODEL || 'meta-llama/Llama-3.1-8B-Instruct';
const HF_PROVIDER = process.env.HF_PROVIDER || 'featherless-ai';
const HF_BASE_URL = process.env.HF_BASE_URL || 'https://router.huggingface.co';
const hfClient = HF_TOKEN ? new HfInference(HF_TOKEN, { baseUrl: HF_BASE_URL }) : null;

const generateGeminiResponse = async (systemInstruction, history, lastMessage) => {
  if (!geminiClient) {
    throw new Error('GEMINI_API_KEY missing');
  }

  const countWords = (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  };

  const conversationHistory = history
    .map((m) => `${m.sender === 'user' ? 'User' : 'Model'}: ${m.text}`)
    .join('\n');

  const fullPrompt = `
${conversationHistory}
User: ${lastMessage}
Model:
`;

  const response = await geminiClient.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: fullPrompt,
    config: {
      systemInstruction,
      temperature: Number.isNaN(GEMINI_TEMPERATURE) ? 1.0 : GEMINI_TEMPERATURE,
      topP: Number.isNaN(GEMINI_TOP_P) ? 0.95 : GEMINI_TOP_P,
      topK: Number.isNaN(GEMINI_TOP_K) ? 40 : GEMINI_TOP_K,
      seed: GEMINI_SEED,
      thinkingLevel: 'medium',
      thinkingBudget: 0,
    },
  });

  let text = response.text || '...';
  console.log('[gemini] response:', text);

  return text;
};

const buildHfPrompt = (systemInstruction, history, lastMessage) => {
  const parts = [];
  if (systemInstruction && systemInstruction.trim()) {
    parts.push(`System: ${systemInstruction.trim()}`);
  }
  for (const msg of history) {
    parts.push(`${msg.sender === 'user' ? 'User' : 'Assistant'}: ${msg.text}`);
  }
  if (lastMessage && lastMessage.trim()) {
    parts.push(`User: ${lastMessage.trim()}`);
  }
  parts.push('Assistant:');
  return parts.join('\n');
};

const generateHuggingFaceResponse = async (model, systemInstruction, history, lastMessage) => {
  if (!hfClient) {
    throw new Error('HF_TOKEN missing');
  }
  const prompt = buildHfPrompt(systemInstruction, history, lastMessage);
  const response = await hfClient.textGeneration({
    model,
    inputs: prompt,
    provider: HF_PROVIDER,
  });
  return response?.generated_text || '...';
};

const getSheetsClient = () => {
  const serviceAccount = getServiceAccount();
  if (!serviceAccount) return null;

  const auth = new google.auth.JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
};

const appendEvaluationRow = async (row) => {
  if (!SHEETS_ID) return { skipped: true, reason: 'missing_sheet_id' };

  const sheets = getSheetsClient();
  if (!sheets) return { skipped: true, reason: 'missing_service_account' };

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEETS_ID,
    range: SHEETS_RANGE,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  return { skipped: false };
};

const pickAgentForCondition = (condition) => {
  const random = Math.random();
  if (condition === CONDITIONS.ELIZA_VS_GEMINI) {
    return random < 0.5 ? AGENTS.ELIZA_CLASSIC : AGENTS.GEMINI_ELIZA;
  }
  if (condition === CONDITIONS.GEMINI_VS_STANFORD) {
    return random < 0.5 ? AGENTS.GEMINI_STUDENT : AGENTS.REAL_STUDENT;
  }
  if (condition === CONDITIONS.BASE_VS_POSTTRAINED) {
    return random < 0.5 ? AGENTS.OLLAMA_BASE : AGENTS.OLLAMA_POSTTRAINED;
  }
  return null;
};

// 2. API Routes
app.get('/api/hello', (req, res) => {
  res.json({ message: "Hello from Node Backend" });
});

app.get('/api/config', (req, res) => {
  res.json({ debugMode: DEBUG_MODE });
});

app.post('/api/session/start', (req, res) => {
  const { condition } = req.body || {};
  if (!condition) {
    return res.status(400).json({ error: 'condition_required' });
  }

  const agentType = pickAgentForCondition(condition);
  if (!agentType) {
    return res.status(400).json({ error: 'invalid_condition' });
  }

  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    condition,
    agentType,
    startedAt: Date.now(),
  });

  return res.json({ sessionId, agentType });
});

app.post('/api/gemini', async (req, res) => {
  try {
    const { systemInstruction, history = [], lastMessage = '' } = req.body || {};
    if (!systemInstruction || !lastMessage) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    const responseText = await generateGeminiResponse(systemInstruction, history, lastMessage);
    return res.json({ text: responseText });
  } catch (error) {
    console.error('Gemini API error:', error?.message || error);
    return res.status(500).json({ error: 'gemini_failed' });
  }
});

app.post('/api/hf', async (req, res) => {
  try {
    const { agentType, systemInstruction = '', history = [], lastMessage = '' } = req.body || {};
    if (!agentType || !lastMessage) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    const model = agentType === AGENTS.OLLAMA_POSTTRAINED ? HF_POSTTRAINED_MODEL : HF_BASE_MODEL;
    const responseText = await generateHuggingFaceResponse(model, systemInstruction, history, lastMessage);
    return res.json({ text: responseText });
  } catch (error) {
    console.error('HuggingFace API error:', error?.message || error);
    return res.status(500).json({ error: 'hf_failed' });
  }
});

app.post('/api/evaluation', async (req, res) => {
  try {
    const {
      sessionId,
      condition,
      agentType,
      rating,
      turnsUser = 0,
      turnsAgent = 0,
      turnsTotal,
      wordsUser = 0,
      wordsAgent = 0,
      wordsTotal,
      durationSeconds = 0,
    } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({ error: 'session_id_required' });
    }

    const session = sessions.get(sessionId);
    const resolvedCondition = session?.condition || condition || 'unknown';
    const resolvedAgentType = session?.agentType || agentType || 'unknown';
    const resolvedTurnsTotal = typeof turnsTotal === 'number' ? turnsTotal : turnsUser + turnsAgent;
    const resolvedWordsTotal = typeof wordsTotal === 'number' ? wordsTotal : wordsUser + wordsAgent;

    const row = [
      new Date().toISOString(),
      sessionId,
      resolvedCondition,
      resolvedAgentType,
      turnsUser,
      turnsAgent,
      resolvedTurnsTotal,
      wordsUser,
      wordsAgent,
      resolvedWordsTotal,
      durationSeconds,
      rating,
    ];

    const result = await appendEvaluationRow(row);
    sessions.delete(sessionId);

    return res.json({ ok: true, logged: !result.skipped, reason: result.reason || null });
  } catch (error) {
    const status = error?.response?.status;
    const data = error?.response?.data;
    console.error('Evaluation logging error:', error?.message || error);
    if (status || data) {
      console.error('Sheets API response:', { status, data });
    }
    return res.status(500).json({ error: 'logging_failed' });
  }
});

// 3. Socket.io Logic
const waitingQueue = [];
const queueTimeouts = new Map();
const socketRoomMembership = new Map();

io.on('connection', (socket) => {
  console.log('a user connected', socket.id);

  socket.on('join_queue', (payload = {}) => {
    if (waitingQueue.length > 0) {
      const partnerId = waitingQueue.shift();
      if (partnerId) {
        const partnerTimeout = queueTimeouts.get(partnerId);
        if (partnerTimeout) clearTimeout(partnerTimeout);
        queueTimeouts.delete(partnerId);

        const roomId = crypto.randomUUID();
        socket.join(roomId);
        const partnerSocket = io.sockets.sockets.get(partnerId);
        if (partnerSocket) {
          partnerSocket.join(roomId);
          partnerSocket.emit('match_found', { roomId });
          socket.emit('match_found', { roomId });
          socketRoomMembership.set(partnerId, roomId);
          socketRoomMembership.set(socket.id, roomId);
        }
      }
    } else {
      waitingQueue.push(socket.id);
      const timeoutId = setTimeout(() => {
        const idx = waitingQueue.indexOf(socket.id);
        if (idx >= 0) {
          waitingQueue.splice(idx, 1);
        }
        queueTimeouts.delete(socket.id);
        socket.emit('match_not_found');
      }, 30000);
      queueTimeouts.set(socket.id, timeoutId);
    }
  });

  socket.on('send_message', ({ roomId, text }) => {
    if (!roomId || !text) return;
    socket.to(roomId).emit('receive_message', {
      text,
      timestamp: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    const idx = waitingQueue.indexOf(socket.id);
    if (idx >= 0) {
      waitingQueue.splice(idx, 1);
    }
    const timeoutId = queueTimeouts.get(socket.id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      queueTimeouts.delete(socket.id);
    }

    const roomId = socketRoomMembership.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit('partner_disconnected');
      socketRoomMembership.delete(socket.id);
    }
  });
});

// 4. Catch-All Handler (IMPORTANT for React Router)
// Any request that doesn't match an API route or static file 
// sends back index.html so React can handle the routing.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});