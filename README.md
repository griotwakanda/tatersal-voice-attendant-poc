# Tatersal Voice Attendant POC

Browser-first voice attendant prototype for auction buyers.

## What this POC validates
- "Call-like" experience in the browser with only 3 UI elements:
  - Name input
  - Phone input
  - Talk button
- User validation by phone (approved/pending/not found)
- Live lot Q&A and bid attempts via AI attendant
- Mock lot state updates in-memory (no real backend dependency)

## Stack
- Node.js + Express
- OpenAI Chat Completions (tool calling)
- Web Speech API (speech recognition + speech synthesis in browser)
- Mock JSON datastore

## Setup

```bash
npm install
cp .env.example .env
# add OPENAI_API_KEY in .env
npm run dev
```

Open: `http://localhost:3000`

## Test users
- Approved: `Daniel Duarte` / `6045551111`
- Approved: `Lidi Mendes` / `6045552222`
- Pending: `Carlos Souza` / `11999999999`

## Test script
1. Start with Daniel (approved)
2. Ask: "Qual lote está aberto?"
3. Ask: "Me dá detalhes do lote"
4. Bid: "Quero dar lance de 15600"
5. Try invalid bid: "Lance 15620" (should fail if min increment unmet)
6. Restart with Carlos (pending), try a bid, verify block

## API endpoints
- `POST /api/session/start`
- `POST /api/voice-turn`
- `GET /api/state`

## Notes
- For deployment, use your own `OPENAI_API_KEY` in environment.
- This POC intentionally avoids Twilio/phone providers to focus on buyer UX.
