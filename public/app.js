let sessionId = null;
let recognition = null;

const nameInput = document.getElementById('name');
const phoneInput = document.getElementById('phone');
const startBtn = document.getElementById('startBtn');
const talkBtn = document.getElementById('talkBtn');
const statusEl = document.getElementById('status');
const lotBox = document.getElementById('lotBox');
const logEl = document.getElementById('log');

function addMsg(text, who = 'bot') {
  const d = document.createElement('div');
  d.className = `msg ${who}`;
  d.textContent = text;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

function getPortugueseVoice() {
  const voices = speechSynthesis.getVoices() || [];
  return voices.find((v) => v.lang?.toLowerCase().startsWith('pt-br')) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith('pt')) ||
    null;
}

function speak(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'pt-BR';
  utterance.rate = 1.02;
  utterance.pitch = 1;
  const voice = getPortugueseVoice();
  if (voice) utterance.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
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
    ? `Sessão ativa ✅ Usuário aprovado (${data.user.name}) · modelo: ${data.model}`
    : `Sessão ativa ⚠️ Usuário não aprovado (${data.user.name || 'não encontrado'}) · modelo: ${data.model}`;

  lotBox.textContent = JSON.stringify(data.lot, null, 2);

  const hello = data.approved
    ? `Olá ${name}, bem-vindo. Já estou no lote aberto. Pode perguntar detalhes ou mandar seu lance por voz.`
    : `Olá ${name}. Consigo te informar tudo sobre o lote, mas por enquanto seu cadastro não está aprovado para registrar lance.`;

  addMsg(hello, 'bot');
  speak(hello);
}

async function sendTurn(text) {
  addMsg(text, 'user');
  statusEl.textContent = 'Processando atendimento...';

  const r = await fetch('/api/voice-turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, transcript: text })
  });

  const data = await r.json();
  if (!r.ok) {
    addMsg(`Erro: ${data.error}`, 'bot');
    statusEl.textContent = 'Erro no atendimento.';
    return;
  }

  addMsg(data.reply, 'bot');
  speak(data.reply);
  statusEl.textContent = `Sessão ativa · modelo em uso: ${data.modelUsed}`;

  const state = await fetch('/api/state').then((x) => x.json());
  lotBox.textContent = JSON.stringify(state.lot, null, 2);
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
    if (sessionId) {
      statusEl.textContent = 'Sessão ativa. Clique em falar novamente.';
    }
  };
}

startBtn.addEventListener('click', startSession);
talkBtn.addEventListener('click', () => {
  if (!sessionId) return;
  recognition?.start();
});

initSpeech();
