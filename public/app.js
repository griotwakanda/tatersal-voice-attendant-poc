let sessionId = null;
let pc = null;
let dc = null;
let localStream = null;
let micTrack = null;
let isTalking = false;

const nameInput = document.getElementById('name');
const phoneInput = document.getElementById('phone');
const startBtn = document.getElementById('startBtn');
const talkBtn = document.getElementById('talkBtn');
const statusEl = document.getElementById('status');
const lotBox = document.getElementById('lotBox');
const logEl = document.getElementById('log');

const remoteAudio = document.createElement('audio');
remoteAudio.autoplay = true;

function addMsg(text, who = 'bot') {
  const d = document.createElement('div');
  d.className = `msg ${who}`;
  d.textContent = text;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

async function startAppSession() {
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  if (!name || !phone) {
    statusEl.textContent = 'Preencha nome e telefone.';
    return null;
  }

  const r = await fetch('/api/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'SESSION_START_FAILED');

  sessionId = data.sessionId;
  lotBox.textContent = JSON.stringify(data.lot, null, 2);

  const hello = data.approved
    ? `Olá ${name}, conexão iniciada. Pode falar sobre lote e lances.`
    : `Olá ${name}. Posso informar o lote, mas seu cadastro ainda não está aprovado para lances.`;
  addMsg(hello, 'bot');

  return data;
}

async function createRealtimeSession() {
  const r = await fetch('/api/realtime/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'REALTIME_SESSION_FAILED');
  return data;
}

async function connectWebRTC(ephemeralKey, model) {
  pc = new RTCPeerConnection();

  pc.ontrack = (event) => {
    remoteAudio.srcObject = event.streams[0];
  };

  dc = pc.createDataChannel('oai-events');
  dc.onopen = () => {
    statusEl.textContent = `Ligação conectada • modelo ${model}. Segure o botão Falar para falar.`;
    sendClientEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Atendimento iniciado. Cumprimente o comprador.' }]
      }
    });
    sendClientEvent({ type: 'response.create' });
  };

  dc.onmessage = (e) => {
    const event = JSON.parse(e.data);
    handleRealtimeEvent(event).catch((err) => {
      console.error(err);
      addMsg('Erro ao processar evento realtime.', 'bot');
    });
  };

  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  micTrack = localStream.getAudioTracks()[0];
  micTrack.enabled = false;
  pc.addTrack(micTrack, localStream);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const baseUrl = 'https://api.openai.com/v1/realtime';
  const sdpResponse = await fetch(`${baseUrl}?model=${encodeURIComponent(model)}`, {
    method: 'POST',
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${ephemeralKey}`,
      'Content-Type': 'application/sdp'
    }
  });

  if (!sdpResponse.ok) {
    const errTxt = await sdpResponse.text();
    throw new Error(`SDP negotiation failed: ${errTxt}`);
  }

  const answer = await sdpResponse.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });
}

function sendClientEvent(event) {
  if (!dc || dc.readyState !== 'open') return;
  dc.send(JSON.stringify(event));
}

async function handleRealtimeEvent(event) {
  if (event.type === 'response.audio_transcript.done' && event.transcript) {
    addMsg(event.transcript, 'bot');
  }

  if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript) {
    addMsg(event.transcript, 'user');
  }

  if (event.type === 'response.function_call_arguments.done') {
    const toolName = event.name;
    const args = JSON.parse(event.arguments || '{}');

    const toolResult = await fetch('/api/tools/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, toolName, args })
    }).then((r) => r.json());

    sendClientEvent({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: event.call_id,
        output: JSON.stringify(toolResult)
      }
    });
    sendClientEvent({ type: 'response.create' });

    const state = await fetch('/api/state').then((x) => x.json());
    lotBox.textContent = JSON.stringify(state.lot, null, 2);
  }
}

function setTalking(active) {
  if (!micTrack) return;
  micTrack.enabled = active;
  isTalking = active;
  talkBtn.textContent = active ? '🛑 Soltar para parar' : '🎤 Falar';
  statusEl.textContent = active
    ? 'Falando com atendente...'
    : 'Ligação conectada. Segure o botão Falar para falar.';
}

async function initCall() {
  try {
    startBtn.disabled = true;
    statusEl.textContent = 'Iniciando sessão...';

    const startData = await startAppSession();
    const rt = await createRealtimeSession();

    await connectWebRTC(rt.client_secret.value, rt.model);

    talkBtn.disabled = false;
    statusEl.textContent = startData.approved
      ? `Conectado ✅ comprador aprovado • modelo ${rt.model}`
      : `Conectado ⚠️ comprador não aprovado • modelo ${rt.model}`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Erro: ${err.message}`;
    startBtn.disabled = false;
  }
}

startBtn.addEventListener('click', initCall);

['mousedown', 'touchstart'].forEach((evt) => {
  talkBtn.addEventListener(evt, (e) => {
    e.preventDefault();
    if (!sessionId || !micTrack) return;
    setTalking(true);
  });
});

['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach((evt) => {
  talkBtn.addEventListener(evt, (e) => {
    e.preventDefault();
    if (!sessionId || !micTrack) return;
    setTalking(false);
  });
});
