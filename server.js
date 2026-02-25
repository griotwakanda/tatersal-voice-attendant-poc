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
const PRIMARY_MODEL = process.env.MODEL || 'gpt-realtime-1.5';
const FALLBACK_MODEL = process.env.FALLBACK_MODEL || 'gpt-4o-mini';

const sessions = new Map();

function normalizePhone(phone = '') {
  return phone.replace(/\D/g, '');
}

function findUserByPhone(phone) {
  const p = normalizePhone(phone);
  return db.users.find((u) => normalizePhone(u.phone) === p) || null;
}

function placeBid({ phone, amount }) {
  const user = findUserByPhone(phone);
  if (!user) return { ok: false, reason: 'USER_NOT_FOUND' };
  if (user.status !== 'approved') return { ok: false, reason: 'USER_NOT_APPROVED' };
  if (db.lot.status !== 'open') return { ok: false, reason: 'LOT_NOT_OPEN' };

  const value = Number(amount);
  if (!Number.isFinite(value)) return { ok: false, reason: 'INVALID_AMOUNT' };

  const minAllowed = db.lot.current_bid + db.lot.min_increment;
  if (value < minAllowed) return { ok: false, reason: 'BID_TOO_LOW', minAllowed };

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
    name: 'get_current_lot',
    description: 'Retorna o resumo do lote atual aberto.',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    type: 'function',
    name: 'get_lot_details',
    description: 'Retorna os detalhes completos do lote atual.',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    type: 'function',
    name: 'place_bid_voice',
    description: 'Registra um lance por voz para o comprador atual da sessão.',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Valor do lance em reais (BRL)' }
      },
      required: ['amount'],
      additionalProperties: false
    }
  }
];

function assistantPrompt({ callerName, callerPhone, approved }) {
  return [
    'Você é o Atendente de Voz do Tatersal Digital.',
    'Fale em PT-BR natural, calor humano, sem tom robótico.',
    `Comprador: ${callerName} | Telefone: ${callerPhone} | Aprovado: ${approved ? 'sim' : 'não'}.`,
    'Prioridade: ser claro, rápido e convincente como um atendente premium de leilão.',
    'Use frases curtas, ritmo de conversa real, e confirme números com precisão.',
    'Quando perguntarem lote/status, use tools.',
    'Quando o comprador der lance, use place_bid_voice.',
    'Se não aprovado, nunca registre lance; explique com respeito e ofereça próximos passos.',
    'Sempre mencionar moeda como reais.',
    'Evite jargão técnico e respostas longas.'
  ].join(' ');
}

async function createResponseWithFallback(payload) {
  try {
    const response = await openai.responses.create({ ...payload, model: PRIMARY_MODEL });
    return { response, modelUsed: PRIMARY_MODEL };
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('model') || msg.includes('not found') || msg.includes('access')) {
      const response = await openai.responses.create({ ...payload, model: FALLBACK_MODEL });
      return { response, modelUsed: FALLBACK_MODEL };
    }
    throw err;
  }
}

function extractText(response) {
  if (response.output_text && response.output_text.trim()) return response.output_text.trim();

  const messageItem = (response.output || []).find((o) => o.type === 'message');
  if (!messageItem?.content) return '';

  const textChunk = messageItem.content.find((c) => c.type === 'output_text');
  return textChunk?.text?.trim() || '';
}

async function runAssistant({ sessionId, message }) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');

  const conversation = [
    { role: 'system', content: assistantPrompt(session) },
    ...session.history,
    { role: 'user', content: message }
  ];

  let { response, modelUsed } = await createResponseWithFallback({
    input: conversation,
    tools,
    temperature: 0.55
  });

  while (true) {
    const toolCalls = (response.output || []).filter((o) => o.type === 'function_call');

    if (!toolCalls.length) {
      const reply = extractText(response) || 'Não consegui entender com confiança. Pode repetir em uma frase curta?';
      session.history.push({ role: 'user', content: message });
      session.history.push({ role: 'assistant', content: reply });
      session.modelUsed = modelUsed;
      return { reply, modelUsed };
    }

    const toolOutputs = [];

    for (const call of toolCalls) {
      let result;
      const args = JSON.parse(call.arguments || '{}');

      if (call.name === 'get_current_lot') {
        result = db.lot;
      } else if (call.name === 'get_lot_details') {
        result = db.lot;
      } else if (call.name === 'place_bid_voice') {
        result = placeBid({ phone: session.callerPhone, amount: args.amount });
      } else {
        result = { ok: false, reason: 'UNKNOWN_TOOL' };
      }

      toolOutputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result)
      });
    }

    const next = await createResponseWithFallback({
      previous_response_id: response.id,
      input: toolOutputs,
      tools,
      temperature: 0.45
    });

    response = next.response;
    modelUsed = next.modelUsed;
  }
}

app.post('/api/session/start', (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'NAME_AND_PHONE_REQUIRED' });

  const user = findUserByPhone(phone);
  const approved = user?.status === 'approved';
  const sessionId = `s-${Date.now()}`;

  sessions.set(sessionId, {
    callerName: name,
    callerPhone: phone,
    approved,
    history: [],
    modelUsed: PRIMARY_MODEL
  });

  res.json({
    sessionId,
    approved,
    user: user || { name, phone, status: 'not_found' },
    lot: db.lot,
    model: PRIMARY_MODEL
  });
});

app.post('/api/voice-turn', async (req, res) => {
  try {
    const { sessionId, transcript } = req.body;
    if (!sessionId || !transcript) return res.status(400).json({ error: 'SESSION_AND_TRANSCRIPT_REQUIRED' });

    const out = await runAssistant({ sessionId, message: transcript });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'VOICE_TURN_FAILED', detail: err.message });
  }
});

app.get('/api/state', (_req, res) => {
  res.json({ lot: db.lot, bids: db.bids.slice(-10) });
});

app.get('/api/model', (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId || !sessions.has(sessionId)) {
    return res.json({ primary: PRIMARY_MODEL, fallback: FALLBACK_MODEL });
  }
  return res.json({ modelUsed: sessions.get(sessionId).modelUsed, primary: PRIMARY_MODEL, fallback: FALLBACK_MODEL });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Tatersal Voice POC running at http://localhost:${port}`);
});
