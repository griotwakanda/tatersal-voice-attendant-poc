import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dataPath = path.join(__dirname, 'data', 'mock-data.json');
const db = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.MODEL || 'gpt-4o-mini';

const sessions = new Map();

function normalizePhone(phone = '') {
  return phone.replace(/\D/g, '');
}

function findUserByPhone(phone) {
  const p = normalizePhone(phone);
  return db.users.find((u) => normalizePhone(u.phone) === p) || null;
}

function getCurrentLot() {
  return db.lot;
}

function getLotDetails() {
  return db.lot;
}

function placeBid({ phone, amount }) {
  const user = findUserByPhone(phone);
  if (!user) return { ok: false, reason: 'USER_NOT_FOUND' };
  if (user.status !== 'approved') return { ok: false, reason: 'USER_NOT_APPROVED' };
  if (db.lot.status !== 'open') return { ok: false, reason: 'LOT_NOT_OPEN' };

  const value = Number(amount);
  if (!Number.isFinite(value)) return { ok: false, reason: 'INVALID_AMOUNT' };

  const minAllowed = db.lot.current_bid + db.lot.min_increment;
  if (value < minAllowed) {
    return { ok: false, reason: 'BID_TOO_LOW', minAllowed };
  }

  db.lot.current_bid = value;
  const bid = {
    id: `b-${Date.now()}`,
    user_phone: user.phone,
    user_name: user.name,
    value,
    created_at: new Date().toISOString()
  };
  db.bids.push(bid);
  return { ok: true, bid, lot: db.lot };
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_current_lot',
      description: 'Return current open lot summary.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_lot_details',
      description: 'Return full lot details including payment terms and weight.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'place_bid_voice',
      description: 'Attempt to place bid for the current caller by phone.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number' }
        },
        required: ['amount'],
        additionalProperties: false
      }
    }
  }
];

function systemPrompt({ callerName, callerPhone, approved }) {
  return `You are Tatersal Voice Attendant in Brazilian Portuguese.
Caller name: ${callerName}
Caller phone: ${callerPhone}
Caller approved: ${approved}
Rules:
- Be concise, helpful, confident.
- If user asks lot status/details, call tools.
- For bids: if caller is not approved, never place bids and explain clearly.
- If approved and caller provides a bid value, call place_bid_voice.
- Always report BRL currency as reais.
- Keep responses under 3 short paragraphs.`;
}

async function runAssistant({ sessionId, message }) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');

  const messages = [
    { role: 'system', content: systemPrompt(session) },
    ...session.history,
    { role: 'user', content: message }
  ];

  while (true) {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.4
    });

    const choice = completion.choices[0].message;

    if (!choice.tool_calls || choice.tool_calls.length === 0) {
      const reply = choice.content || 'Não consegui processar, tenta novamente.';
      session.history.push({ role: 'user', content: message });
      session.history.push({ role: 'assistant', content: reply });
      return reply;
    }

    messages.push(choice);

    for (const call of choice.tool_calls) {
      let result;
      const args = JSON.parse(call.function.arguments || '{}');

      if (call.function.name === 'get_current_lot') {
        result = getCurrentLot();
      } else if (call.function.name === 'get_lot_details') {
        result = getLotDetails();
      } else if (call.function.name === 'place_bid_voice') {
        result = placeBid({ phone: session.callerPhone, amount: args.amount });
      } else {
        result = { ok: false, reason: 'UNKNOWN_TOOL' };
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }
  }
}

app.post('/api/session/start', (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'NAME_AND_PHONE_REQUIRED' });
  }

  const user = findUserByPhone(phone);
  const approved = user?.status === 'approved';
  const sessionId = `s-${Date.now()}`;

  sessions.set(sessionId, {
    callerName: name,
    callerPhone: phone,
    approved,
    history: []
  });

  res.json({
    sessionId,
    approved,
    user: user || { name, phone, status: 'not_found' },
    lot: db.lot
  });
});

app.post('/api/voice-turn', async (req, res) => {
  try {
    const { sessionId, transcript } = req.body;
    if (!sessionId || !transcript) {
      return res.status(400).json({ error: 'SESSION_AND_TRANSCRIPT_REQUIRED' });
    }

    const reply = await runAssistant({ sessionId, message: transcript });
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'VOICE_TURN_FAILED', detail: err.message });
  }
});

app.get('/api/state', (_req, res) => {
  res.json({ lot: db.lot, bids: db.bids.slice(-10) });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Tatersal Voice POC running at http://localhost:${port}`);
});
