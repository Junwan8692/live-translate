import { GoogleGenAI, Modality } from 'https://esm.run/@google/genai';
import { MODEL } from './config.js';

export function createEngine(cb) {
  let session = null, mediaStream = null, inCtx = null, outCtx = null, proc = null;
  let running = false, paused = false, nextPlayTime = 0, curIn = '', curOut = '';
  let gen = 0, flushTimer = null, playback = false;

  async function connect(key, myGen) {
    const lang = cb.getLang(); // 연결 시점 고정 — 변경 시 restartLanguage()가 재연결시킴
    const ai = new GoogleGenAI({ apiKey: key });
    session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        translationConfig: { targetLanguageCode: lang, echoTargetLanguage: false },
      },
      callbacks: {
        onopen: () => cb.onStatus(`listening:${lang}`),
        onmessage: handleMessage,
        onerror: e => cb.onError(e.message),
        onclose: () => {
          if (running && !paused && myGen === gen) {
            cb.onStatus('reconnecting');
            setTimeout(() => {
              if (running && !paused && myGen === gen)
                connect(key, myGen).catch(e => cb.onError('재연결 실패: ' + e.message));
            }, 600);
          }
        },
      },
    });
  }

  function handleMessage(msg) {
    const c = msg.serverContent;
    if (!c) return;
    let gotText = false;
    if (c.inputTranscription?.text) { curIn += c.inputTranscription.text; gotText = true; }
    if (c.outputTranscription?.text) { curOut += c.outputTranscription.text; gotText = true; }
    if (gotText) cb.onPartial({ original: curIn, translated: curOut });
    for (const p of c.modelTurn?.parts || []) if (p.inlineData?.data) playChunk(p.inlineData.data);
    // 이 모델은 turnComplete를 보내지 않음 — 텍스트가 2.5초간 없으면 문단 확정.
    // 오디오 청크로 타이머를 리셋하면 안 됨(오디오는 텍스트보다 수 초 뒤까지 옴).
    if (gotText) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 2500); }
  }

  function flush() {
    clearTimeout(flushTimer);
    if (curIn.trim() || curOut.trim())
      cb.onSegment({ originalText: curIn.trim(), translatedText: curOut.trim() });
    curIn = curOut = '';
    cb.onPartial({ original: '', translated: '' });
  }

  // ---------- 오디오 입력 (16kHz PCM16, ~128ms 청크) ----------
  function pumpAudio() {
    inCtx = new AudioContext({ sampleRate: 16000 });
    const src = inCtx.createMediaStreamSource(mediaStream);
    // ponytail: ScriptProcessor는 deprecated지만 AudioWorklet보다 단순. Phase 3에서 교체 검토.
    proc = inCtx.createScriptProcessor(2048, 1, 1);
    proc.onaudioprocess = e => {
      if (!session) return;
      const f32 = e.inputBuffer.getChannelData(0);
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-1, Math.min(1, f32[i])) * 0x7fff;
      session.sendRealtimeInput({ audio: { data: b64(i16.buffer), mimeType: 'audio/pcm;rate=16000' } });
    };
    src.connect(proc);
    proc.connect(inCtx.destination); // ScriptProcessor는 destination 연결 없이는 동작 안 함(출력은 무음)
  }

  function b64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ---------- 오디오 출력 (24kHz PCM16) ----------
  function playChunk(b64data) {
    if (!playback) return;
    if (!outCtx) outCtx = new AudioContext({ sampleRate: 24000 });
    const bin = atob(b64data);
    const f32 = new Float32Array(bin.length / 2);
    for (let i = 0; i < f32.length; i++) {
      const v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8); // little-endian
      f32[i] = (v >= 0x8000 ? v - 0x10000 : v) / 0x8000;
    }
    const buf = outCtx.createBuffer(1, f32.length, 24000);
    buf.getChannelData(0).set(f32);
    const src = outCtx.createBufferSource();
    src.buffer = buf;
    src.connect(outCtx.destination);
    nextPlayTime = Math.max(nextPlayTime, outCtx.currentTime + 0.05);
    src.start(nextPlayTime);
    nextPlayTime += buf.duration;
  }

  function teardownPump() {
    clearTimeout(flushTimer);
    try { proc?.disconnect(); } catch {}
    proc = null;
    inCtx?.close();
    inCtx = null;
  }

  return {
    async start(source) {
      const key = cb.getKey();
      if (!key) { cb.onError('NO_KEY'); throw new Error('NO_KEY'); }
      mediaStream = source === 'tab'
        ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const track = mediaStream.getAudioTracks()[0];
      if (!track) { this.stop(); cb.onError('NO_AUDIO_TRACK'); throw new Error('NO_AUDIO_TRACK'); } // 탭 공유 시 "오디오 공유" 미체크
      track.addEventListener('ended', () => cb.onError('TRACK_ENDED')); // 사용자가 공유 중단 → app이 pause 처리
      running = true; paused = false;
      try {
        await connect(key, ++gen);
        pumpAudio();
      } catch (error) {
        this.stop();                       // 연결 실패 뒤 마이크/탭 캡처가 남지 않게 정리
        throw error;
      }
    },

    pause() {
      paused = true;
      gen++;                     // 진행 중인 onclose 재연결 타이머 무효화
      flush();
      teardownPump();
      try { session?.close(); } catch {}
      session = null;
      // mediaStream은 유지 — resume 시 탭 픽커를 다시 띄우지 않기 위함
    },

    async resume() {
      const key = cb.getKey();
      paused = false;
      await connect(key, ++gen);
      pumpAudio();
    },

    stop() {
      running = false; paused = false;
      gen++;
      flush();
      teardownPump();
      try { session?.close(); } catch {}
      session = null;
      mediaStream?.getTracks().forEach(t => t.stop());
      mediaStream = null;
    },

    setPlayback(on) { playback = on; },

    // 언어 변경: 세션만 닫으면 onclose 가드(myGen===gen 유지)가 새 언어로 재연결
    restartLanguage() { if (session) { flush(); try { session.close(); } catch {} } },
  };
}
