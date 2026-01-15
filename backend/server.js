const express = require('express');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { Server } = require("socket.io");
const { google } = require('googleapis');

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
};

const AGENTS = {
  ELIZA_CLASSIC: 'ELIZA_CLASSIC',
  GEMINI_ELIZA: 'GEMINI_ELIZA',
  GEMINI_STUDENT: 'GEMINI_STUDENT',
  REAL_STUDENT: 'REAL_STUDENT',
};

const sessions = new Map();

const SHEETS_ID = process.env.GOOGLE_SHEETS_ID || '';
const SHEETS_RANGE = process.env.GOOGLE_SHEETS_RANGE || 'Sheet1!A1';

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
  return null;
};

// 2. API Routes
app.get('/api/hello', (req, res) => {
  res.json({ message: "Hello from Node Backend" });
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
    console.error('Evaluation logging error:', error);
    return res.status(500).json({ error: 'logging_failed' });
  }
});

// 3. Socket.io Logic
const waitingQueues = new Map();
const socketQueueMembership = new Map();

const getQueue = (condition) => {
  if (!waitingQueues.has(condition)) {
    waitingQueues.set(condition, []);
  }
  return waitingQueues.get(condition);
};

io.on('connection', (socket) => {
  console.log('a user connected', socket.id);

  socket.on('join_queue', (payload = {}) => {
    const { condition } = payload;
    if (!condition) return;

    const queue = getQueue(condition);
    if (queue.length > 0) {
      const partnerId = queue.shift();
      if (partnerId) {
        const roomId = crypto.randomUUID();
        socket.join(roomId);
        const partnerSocket = io.sockets.sockets.get(partnerId);
        if (partnerSocket) {
          partnerSocket.join(roomId);
          partnerSocket.emit('match_found', { roomId });
          socket.emit('match_found', { roomId });
          socketQueueMembership.delete(partnerId);
          socketQueueMembership.delete(socket.id);
        }
      }
    } else {
      queue.push(socket.id);
      socketQueueMembership.set(socket.id, condition);
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
    const condition = socketQueueMembership.get(socket.id);
    if (condition) {
      const queue = getQueue(condition);
      const idx = queue.indexOf(socket.id);
      if (idx >= 0) {
        queue.splice(idx, 1);
      }
      socketQueueMembership.delete(socket.id);
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