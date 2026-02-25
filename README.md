# Tatersal Voice Attendant POC

Browser-first voice attendant prototype for auction buyers using OpenAI Realtime API.

## What this POC validates
- "Call-like" experience in browser with only:
  - Name input
  - Phone input
  - Push-to-talk button
- User validation by phone (approved/pending/not found)
- Realtime voice conversation over WebRTC
- Function calling in Realtime flow (`function_call` + `function_call_output`)
- Mock lot state updates in-memory (no real backend dependency)

## Stack
- Node.js + Express
- OpenAI Realtime API (`gpt-realtime-1.5`) + WebRTC
- Web Speech not required for the call loop
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
2. Hold `🎤 Falar` and ask: "Qual lote está aberto?"
3. Ask: "Me dá detalhes do lote"
4. Bid: "Quero dar lance de quinze mil e seiscentos"
5. Try invalid bid below min increment
6. Restart with Carlos (pending), try a bid, verify block

## API endpoints
- `POST /api/session/start`
- `POST /api/realtime/session`
- `POST /api/tools/execute`
- `GET /api/state`

## Notes
- Deployment requires your own `OPENAI_API_KEY`.
- This POC intentionally avoids Twilio/phone providers to focus only buyer voice UX.
