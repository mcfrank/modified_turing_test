const express = require('express');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { Server } = require("socket.io");
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { OAuth2Client } = require('google-auth-library');
const { GoogleGenAI } = require('@google/genai');
const { AGENT_PROMPTS } = require('./prompts');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '1mb' }));

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
  LLAMA_BASE: 'LLAMA_BASE',
  LLAMA_POSTTRAINED: 'LLAMA_POSTTRAINED',
};

// sessionId -> { condition, agentType, giveaways, startedAt, messages }.
// Model calls are only allowed for a live server-issued session, within these
// caps, so the endpoint can't be used as a general-purpose LLM proxy.
const sessions = new Map();
const SESSION_MAX_MS = 6 * 60 * 1000; // 3-minute chat plus matching and slack
const SESSION_MAX_MESSAGES = 60;

const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// Gemini: uses Vertex AI via Application Default Credentials (the Cloud Run
// service account in production) when GOOGLE_GENAI_USE_VERTEXAI=true and
// GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION are set; otherwise GEMINI_API_KEY.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const GEMINI_THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL || 'minimal';
const GEMINI_TEMPERATURE = Number.parseFloat(process.env.GEMINI_TEMPERATURE || '1.0');
const GEMINI_TOP_P = Number.parseFloat(process.env.GEMINI_TOP_P || '0.95');
const GEMINI_TOP_K = Number.parseInt(process.env.GEMINI_TOP_K || '40', 10);
const GEMINI_SEED = process.env.GEMINI_SEED ? Number.parseInt(process.env.GEMINI_SEED, 10) : undefined;
const geminiClient = new GoogleGenAI(GEMINI_API_KEY ? { apiKey: GEMINI_API_KEY } : {});

const HF_TOKEN = process.env.HF_TOKEN || '';
const HF_BASE_MODEL = process.env.HF_BASE_MODEL || 'meta-llama/Llama-3.1-8B';
const HF_POSTTRAINED_MODEL = process.env.HF_POSTTRAINED_MODEL || 'meta-llama/Llama-3.1-8B-Instruct';
const HF_PROVIDER = process.env.HF_PROVIDER || '';
// Base models are only served by featherless-ai; instruct models have more providers.
const HF_POSTTRAINED_PROVIDER = process.env.HF_POSTTRAINED_PROVIDER || HF_PROVIDER;
const HF_BASE_URL = process.env.HF_BASE_URL || 'https://router.huggingface.co';
const HF_BASE_MAX_TOKENS = Number.parseInt(process.env.HF_BASE_MAX_TOKENS || '60', 10);

// Logged at startup so a bad token or an HF block shows up before class.
if (HF_TOKEN) {
  fetch('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${HF_TOKEN}` } })
    .then(async (r) => console.log(`[hf] whoami status=${r.status}`, r.ok ? (await r.json()).name : ''))
    .catch((e) => console.error('[hf] whoami failed:', e.message));
}

const db = new Firestore({ databaseId: process.env.FIRESTORE_DATABASE || '(default)' });
const sessionsCol = db.collection('turing_sessions');
const settingsDoc = db.collection('turing_settings').doc('current');
const DEFAULT_SETTINGS = { giveaways: false, run: 'default', runs: ['default'] };

const OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const oauthClient = new OAuth2Client(OAUTH_CLIENT_ID);

const getSettings = async () => {
  const snap = await settingsDoc.get();
  return { ...DEFAULT_SETTINGS, ...(snap.exists ? snap.data() : {}) };
};

const modelForAgent = (agentType) => {
  if (agentType === AGENTS.ELIZA_CLASSIC) return 'elizabot';
  if (agentType === AGENTS.LLAMA_BASE) return HF_BASE_MODEL;
  if (agentType === AGENTS.LLAMA_POSTTRAINED) return HF_POSTTRAINED_MODEL;
  if (agentType === AGENTS.REAL_STUDENT) return 'human';
  return GEMINI_MODEL;
};

const generateGeminiResponse = async (systemInstruction, history, lastMessage) => {
  const conversationHistory = history
    .map((m) => `${m.sender === 'user' ? 'User' : 'Model'}: ${m.text}`)
    .join('\n');

  const fullPrompt = `
${conversationHistory}
User: ${lastMessage}
Model:
`;

  const response = await geminiClient.models.generateContent({
    model: GEMINI_MODEL,
    contents: fullPrompt,
    config: {
      systemInstruction,
      temperature: Number.isNaN(GEMINI_TEMPERATURE) ? 1.0 : GEMINI_TEMPERATURE,
      topP: Number.isNaN(GEMINI_TOP_P) ? 0.95 : GEMINI_TOP_P,
      topK: Number.isNaN(GEMINI_TOP_K) ? 40 : GEMINI_TOP_K,
      seed: GEMINI_SEED,
      thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL },
    },
  });

  const text = response.text || '...';
  console.log('[gemini] response:', text);
  return text;
};

const buildHfMessages = (systemInstruction, history, lastMessage) => {
  const messages = [];
  if (systemInstruction && systemInstruction.trim()) {
    messages.push({ role: 'system', content: systemInstruction.trim() });
  }
  const push = (role, content) => {
    // Chat templates expect alternating roles; merge consecutive messages
    // from the same side (possible now that input isn't locked while waiting).
    const prev = messages[messages.length - 1];
    if (prev && prev.role === role) prev.content += `\n${content}`;
    else messages.push({ role, content });
  };
  for (const msg of history) {
    push(msg.sender === 'user' ? 'user' : 'assistant', msg.text);
  }
  if (lastMessage && lastMessage.trim()) {
    push('user', lastMessage.trim());
  }
  return messages;
};

const buildHfBasePrompt = (systemInstruction, history, lastMessage) => {
  const parts = [];
  if (systemInstruction && systemInstruction.trim()) {
    parts.push(`SYSTEM: ${systemInstruction.trim()}`);
  }
  for (const msg of history) {
    const roleLabel = msg.sender === 'user' ? 'HUMAN' : 'MODEL';
    parts.push(`${roleLabel}: ${msg.text}`);
  }
  if (lastMessage && lastMessage.trim()) {
    parts.push(`HUMAN: ${lastMessage.trim()}`);
  }
  parts.push('MODEL:');
  return parts.join('\n');
};

const generateHuggingFaceResponse = async (model, systemInstruction, history, lastMessage, mode) => {
  if (!HF_PROVIDER) {
    throw new Error('HF_PROVIDER missing');
  }
  if (!HF_TOKEN) {
    throw new Error('HF_TOKEN missing');
  }
  const providerModel = `${model}:${HF_POSTTRAINED_PROVIDER}`;
  const url = mode === 'text'
    ? `${HF_BASE_URL}/${encodeURIComponent(HF_PROVIDER)}/v1/completions`
    : `${HF_BASE_URL}/v1/chat/completions`;
  const prompt = buildHfBasePrompt(systemInstruction, history, lastMessage);
  const body = mode === 'text'
    ? {
      model,
      prompt,
      max_tokens: Number.isNaN(HF_BASE_MAX_TOKENS) ? 60 : HF_BASE_MAX_TOKENS,
      max_new_tokens: Number.isNaN(HF_BASE_MAX_TOKENS) ? 60 : HF_BASE_MAX_TOKENS,
      return_full_text: false,
      repetition_penalty: 1.1,
      stop: ['\nHUMAN:'],
    }
    : { model: providerModel, messages: buildHfMessages(systemInstruction, history, lastMessage), stream: false };
  const post = () => fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let response = await post();
  if (response.status === 503 || response.status === 429) {
    // Providers intermittently report "temporarily at capacity"; retry once.
    await new Promise((r) => setTimeout(r, 1500));
    response = await post();
  }
  if (!response.ok) {
    const errText = (await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`HF error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  if (mode === 'text') {
    const text = data?.choices?.[0]?.text || data?.generated_text || '';
    if (!text) return '...';
    return text.startsWith(prompt) ? text.slice(prompt.length).trim() : text;
  }
  return data?.choices?.[0]?.message?.content || '...';
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
    return random < 0.5 ? AGENTS.LLAMA_BASE : AGENTS.LLAMA_POSTTRAINED;
  }
  return null;
};

const isLive = (session) => Date.now() - session.startedAt < SESSION_MAX_MS;

// Looks up a session in memory, falling back to Firestore so that sessions
// survive an instance restart mid-class.
const getLiveSession = async (sessionId) => {
  if (typeof sessionId !== 'string' || !sessionId) return null;
  let session = sessions.get(sessionId);
  if (!session) {
    const snap = await sessionsCol.doc(sessionId).get();
    const data = snap.exists ? snap.data() : null;
    if (!data || data.status === 'completed' || !data.startedAt) return null;
    session = {
      condition: data.condition,
      agentType: data.agentType,
      giveaways: Boolean(data.giveaways),
      startedAt: data.startedAt.toMillis(),
      messages: 0,
    };
    sessions.set(sessionId, session);
  }
  return isLive(session) ? session : null;
};

setInterval(() => {
  for (const [id, session] of sessions) {
    if (!isLive(session)) sessions.delete(id);
  }
}, 60 * 1000).unref();

const updateSession = (sessionId, data) => {
  if (!sessionId) return Promise.resolve();
  return sessionsCol.doc(sessionId).set(data, { merge: true })
    .catch((error) => console.error('Firestore session update failed:', error?.message || error));
};

// 2. API Routes
app.get('/api/hello', (req, res) => {
  res.json({ message: "Hello from Node Backend" });
});

app.get('/api/config', (req, res) => {
  res.json({ debugMode: DEBUG_MODE, oauthClientId: OAUTH_CLIENT_ID });
});

app.post('/api/session/start', async (req, res) => {
  const { condition, forcedAgentType } = req.body || {};
  if (!condition) {
    return res.status(400).json({ error: 'condition_required' });
  }

  const agentType = DEBUG_MODE && Object.values(AGENTS).includes(forcedAgentType)
    ? forcedAgentType
    : pickAgentForCondition(condition);
  if (!agentType) {
    return res.status(400).json({ error: 'invalid_condition' });
  }

  let settings = DEFAULT_SETTINGS;
  try {
    settings = await getSettings();
  } catch (error) {
    console.error('Failed to read settings, using defaults:', error?.message || error);
  }

  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { condition, agentType, giveaways: settings.giveaways, startedAt: Date.now(), messages: 0 });
  await updateSession(sessionId, {
    condition,
    agentType,
    model: modelForAgent(agentType),
    run: settings.run,
    giveaways: settings.giveaways,
    debug: DEBUG_MODE,
    status: 'started',
    startedAt: FieldValue.serverTimestamp(),
  });

  return res.json({ sessionId, agentType, giveaways: settings.giveaways });
});

app.post('/api/agent', async (req, res) => {
  const { sessionId, history = [], lastMessage = '', greeting = false } = req.body || {};
  let session;
  try {
    session = await getLiveSession(sessionId);
  } catch (error) {
    console.error('Session lookup failed:', error?.message || error);
  }
  if (!session) {
    return res.status(403).json({ error: 'no_live_session' });
  }
  if (++session.messages > SESSION_MAX_MESSAGES) {
    return res.status(429).json({ error: 'session_message_limit' });
  }
  const resolvedAgentType = session.agentType;
  const giveaways = session.giveaways;
  const promptKey = resolvedAgentType === AGENTS.GEMINI_STUDENT && giveaways
    ? 'GEMINI_STUDENT_LEGACY'
    : resolvedAgentType;
  const prompts = AGENT_PROMPTS[promptKey];
  if (!prompts || !Array.isArray(history) || history.length > 200 || String(lastMessage).length > 2000) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  if (!greeting && !lastMessage) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const systemInstruction = greeting ? (prompts.greetingSystem || prompts.system) : prompts.system;
  const message = greeting ? prompts.greeting : lastMessage;
  const cleanHistory = history.map((m) => ({ sender: m.sender, text: String(m.text || '') }));

  try {
    let text;
    if (resolvedAgentType === AGENTS.LLAMA_BASE || resolvedAgentType === AGENTS.LLAMA_POSTTRAINED) {
      const isPostTrained = resolvedAgentType === AGENTS.LLAMA_POSTTRAINED;
      text = await generateHuggingFaceResponse(
        isPostTrained ? HF_POSTTRAINED_MODEL : HF_BASE_MODEL,
        systemInstruction, cleanHistory, message, isPostTrained ? 'chat' : 'text');
    } else {
      text = await generateGeminiResponse(systemInstruction, cleanHistory, message);
    }
    return res.json({ text });
  } catch (error) {
    console.error(`Agent API error (${resolvedAgentType}):`, error?.message || error);
    return res.status(500).json({ error: 'agent_failed' });
  }
});

app.post('/api/evaluation', async (req, res) => {
  try {
    const {
      sessionId,
      rating,
      turnsUser = 0,
      turnsAgent = 0,
      turnsTotal,
      wordsUser = 0,
      wordsAgent = 0,
      wordsTotal,
      durationSeconds = 0,
      endReason = null,
      transcript = [],
    } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({ error: 'session_id_required' });
    }

    const snap = await sessionsCol.doc(String(sessionId)).get();
    if (!snap.exists || snap.data().status === 'completed') {
      return res.status(403).json({ error: 'unknown_session' });
    }
    const data = {
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
      rating: Number(rating),
      turnsUser,
      turnsAgent,
      turnsTotal: typeof turnsTotal === 'number' ? turnsTotal : turnsUser + turnsAgent,
      wordsUser,
      wordsAgent,
      wordsTotal: typeof wordsTotal === 'number' ? wordsTotal : wordsUser + wordsAgent,
      durationSeconds,
      endReason,
      transcript: (Array.isArray(transcript) ? transcript : []).slice(0, 300).map((m) => ({
        sender: m.sender,
        text: String(m.text || '').slice(0, 2000),
        t: Number(m.timestamp) || null,
      })),
    };
    await sessionsCol.doc(sessionId).set(data, { merge: true });
    sessions.delete(sessionId);

    return res.json({ ok: true, logged: true });
  } catch (error) {
    console.error('Evaluation logging error:', error?.message || error);
    return res.status(500).json({ error: 'logging_failed' });
  }
});

// Admin API: Google Sign-In ID token, checked against ADMIN_EMAILS.
const requireAdmin = async (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token || !OAUTH_CLIENT_ID) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken: token, audience: OAUTH_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = (payload?.email || '').toLowerCase();
    if (!payload?.email_verified || !ADMIN_EMAILS.includes(email)) {
      return res.status(403).json({ error: 'forbidden', email });
    }
    req.adminEmail = email;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'invalid_token' });
  }
};

const toIso = (ts) => (ts && typeof ts.toDate === 'function' ? ts.toDate().toISOString() : null);

const loadSessions = async (run) => {
  const query = run ? sessionsCol.where('run', '==', run) : sessionsCol;
  const snap = await query.get();
  return snap.docs.map((d) => {
    const s = d.data();
    return { ...s, id: d.id, startedAt: toIso(s.startedAt), completedAt: toIso(s.completedAt) };
  });
};

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ email: req.adminEmail });
});

app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  res.json(await getSettings());
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  const { giveaways, run } = req.body || {};
  const update = {};
  if (typeof giveaways === 'boolean') update.giveaways = giveaways;
  if (typeof run === 'string' && run.trim()) {
    update.run = run.trim().slice(0, 80);
    update.runs = FieldValue.arrayUnion(update.run);
  }
  await settingsDoc.set({ ...update, updatedBy: req.adminEmail }, { merge: true });
  res.json(await getSettings());
});

app.get('/api/admin/sessions', requireAdmin, async (req, res) => {
  try {
    res.json(await loadSessions(req.query.run || null));
  } catch (error) {
    console.error('Admin sessions error:', error?.message || error);
    res.status(500).json({ error: 'load_failed' });
  }
});

// 3. Socket.io Logic
const waitingQueue = [];
const queueTimeouts = new Map();
const socketRoomMembership = new Map();
const socketSessionIds = new Map();

io.on('connection', (socket) => {
  console.log('a user connected', socket.id);

  socket.on('join_queue', async (payload = {}) => {
    const session = await getLiveSession(payload.sessionId).catch(() => null);
    if (!session || session.agentType !== AGENTS.REAL_STUDENT || waitingQueue.includes(socket.id)) {
      socket.emit('match_not_found');
      return;
    }
    socketSessionIds.set(socket.id, payload.sessionId);

    // Skip partners that disconnected without being removed from the queue.
    let partnerSocket = null;
    while (waitingQueue.length > 0 && !partnerSocket) {
      const partnerId = waitingQueue.shift();
      const partnerTimeout = queueTimeouts.get(partnerId);
      if (partnerTimeout) clearTimeout(partnerTimeout);
      queueTimeouts.delete(partnerId);
      partnerSocket = io.sockets.sockets.get(partnerId) || null;
    }

    if (partnerSocket) {
      const roomId = crypto.randomUUID();
      socket.join(roomId);
      partnerSocket.join(roomId);
      partnerSocket.emit('match_found', { roomId });
      socket.emit('match_found', { roomId });
      socketRoomMembership.set(partnerSocket.id, roomId);
      socketRoomMembership.set(socket.id, roomId);
      updateSession(socketSessionIds.get(socket.id), { roomId });
      updateSession(socketSessionIds.get(partnerSocket.id), { roomId });
    } else {
      waitingQueue.push(socket.id);
      const timeoutId = setTimeout(() => {
        const idx = waitingQueue.indexOf(socket.id);
        if (idx >= 0) {
          waitingQueue.splice(idx, 1);
        }
        queueTimeouts.delete(socket.id);
        updateSession(socketSessionIds.get(socket.id), { status: 'no_partner' });
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

  socket.on('typing', ({ roomId }) => {
    if (!roomId) return;
    socket.to(roomId).emit('partner_typing');
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
    socketSessionIds.delete(socket.id);

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
