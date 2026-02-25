import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dataPath = path.join(__dirname, 'data', 'mock-data.json');
const db = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

const REALTIME_MODEL = process.env.REALTIME_MODEL || process.env.MODEL || 'gpt-realtime-1.5';
const PORT = process.env.PORT || 3000;

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

function getRealtimeInstructions(session) {
  return [
    'Você é o Atendente de Voz do Tatersal Digital, em português do Brasil.',
    'Fale de forma natural, humana, cordial e objetiva. Nada de tom robótico.',
    `Comprador atual: ${session.callerName}. Telefone: ${session.callerPhone}.`,
    `Status do comprador: ${session.approved ? 'aprovado para lances' : 'não aprovado para lances'}.`,
    'Sempre que perguntarem status/detalhes do lote, use as funções.',
    'Sempre que o comprador der um lance, use place_bid_voice.',
    'Se não aprovado, nunca registre lance e explique o motivo com respeito.',
    'Sempre informe valores em reais (BRL).',
    'Respostas curtas, claras e com ritmo de conversa de atendimento premium.'
  ].join(' ');
}

function realtimeTools() {
  return [
    {
      type: 'function',
      name: 'get_current_lot',
      description: 'Retorna resumo do lote aberto atual',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      type: 'function',
      name: 'get_lot_details',
      description: 'Retorna detalhes completos do lote atual',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      type: 'function',
      name: 'place_bid_voice',
      description: 'Registra lance por voz para o comprador atual da sessão',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Valor do lance em BRL' }
        },
        required: ['amount'],
        additionalProperties: false
      }
    }
  ];
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
    userStatus: user?.status || 'not_found'
  });

  res.json({
    sessionId,
    approved,
    user: user || { name, phone, status: 'not_found' },
    lot: db.lot
  });
});

app.post('/api/realtime/session', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY_MISSING' });

    const payload = {
      model: REALTIME_MODEL,
      voice: 'alloy',
      modalities: ['audio', 'text'],
      instructions: getRealtimeInstructions(session),
      input_audio_transcription: {
        model: 'gpt-4o-mini-transcribe',
        language: 'pt'
      },
      turn_detection: {
        type: 'server_vad',
        create_response: true,
        interrupt_response: true
      },
      tools: realtimeTools()
    };

    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: 'REALTIME_SESSION_CREATE_FAILED',
        detail: data
      });
    }

    return res.json({
      model: REALTIME_MODEL,
      client_secret: data.client_secret,
      expires_at: data.expires_at
    });
  } catch (err) {
    return res.status(500).json({ error: 'REALTIME_SESSION_EXCEPTION', detail: err.message });
  }
});

app.post('/api/tools/execute', (req, res) => {
  const { sessionId, toolName, args } = req.body;
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ ok: false, reason: 'SESSION_NOT_FOUND' });

  if (toolName === 'get_current_lot') return res.json({ ok: true, data: db.lot });
  if (toolName === 'get_lot_details') return res.json({ ok: true, data: db.lot });
  if (toolName === 'place_bid_voice') {
    const out = placeBid({ phone: session.callerPhone, amount: args?.amount });
    return res.json(out);
  }

  return res.status(400).json({ ok: false, reason: 'UNKNOWN_TOOL' });
});

app.get('/api/state', (_req, res) => {
  res.json({ lot: db.lot, bids: db.bids.slice(-10) });
});

app.listen(PORT, () => {
  console.log(`Tatersal Voice POC running at http://localhost:${PORT}`);
});
