let sessionId = null;
let recognition = null;

const nameInput = document.getElementById('name');
const phoneInput = document.getElementById('phone');
const startBtn = document.getElementById('startBtn');
const talkBtn = document.getElementById('talkBtn');
const statusEl = document.getElementById('status');
const lotBox = document.getElementById('lotBox');
const logEl = document.getElementById('log');

function addMsg(text, who='bot') {
  const d = document.createElement('div');
  d.className = `msg ${who}`;
  d.textContent = text;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

function speak(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'pt-BR';
  window.speechSynthesis.speak(u);
}

async function startSession() {
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  if (!name || !phone) {
    statusEl.textContent = 'Preencha nome e telefone.';
    return;
  }

  const r = await fetch('/api/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone })
  });
  const data = await r.json();
  if (!r.ok) {
    statusEl.textContent = `Erro: ${data.error}`;
    return;
  }

  sessionId = data.sessionId;
  talkBtn.disabled = false;
  statusEl.textContent = data.approved
    ? `Sessão ativa ✅ Usuário aprovado (${data.user.name})`
    : `Sessão ativa ⚠️ Usuário não aprovado (${data.user.name || 'não encontrado'})`;
  lotBox.textContent = JSON.stringify(data.lot, null, 2);

  const hello = data.approved
    ? `Olá ${name}, ligação iniciada. Pode perguntar sobre o lote ou dar seu lance.`
    : `Olá ${name}. Posso informar o lote, mas seu usuário não está aprovado para lances.`;
  addMsg(hello, 'bot');
  speak(hello);
}

async function sendTurn(text) {
  addMsg(text, 'user');
  const r = await fetch('/api/voice-turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, transcript: text })
  });
  const data = await r.json();
  if (!r.ok) {
    addMsg(`Erro: ${data.error}`, 'bot');
    return;
  }
  addMsg(data.reply, 'bot');
  speak(data.reply);

  const s = await fetch('/api/state').then((x) => x.json());
  lotBox.textContent = JSON.stringify(s.lot, null, 2);
}

function initSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    statusEl.textContent = 'Seu navegador não suporta SpeechRecognition.';
    talkBtn.disabled = true;
    return;
  }

  recognition = new SR();
  recognition.lang = 'pt-BR';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    statusEl.textContent = '🎙️ Ouvindo...';
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    statusEl.textContent = `Você disse: "${transcript}"`;
    sendTurn(transcript);
  };

  recognition.onerror = (event) => {
    statusEl.textContent = `Erro de voz: ${event.error}`;
  };

  recognition.onend = () => {
    if (sessionId) statusEl.textContent = 'Sessão ativa. Clique em falar novamente.';
  };
}

startBtn.addEventListener('click', startSession);
talkBtn.addEventListener('click', () => {
  if (!sessionId) return;
  recognition?.start();
});

initSpeech();
