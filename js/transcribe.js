// 녹음 파일 사후 전사+번역 — generateContent(structured output).
// 20MB 이하는 inline, 초과는 Files API 업로드 후 참조.
import { GoogleGenAI } from 'https://esm.run/@google/genai';
import { BATCH_MODEL } from './config.js';

const INLINE_MAX = 20 * 1024 * 1024;

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      startSec: { type: 'NUMBER', description: '문단 시작 시각(초, 오디오 기준)' },
      original: { type: 'STRING', description: '원문 전사' },
      translated: { type: 'STRING', description: '대상 언어 번역' },
    },
    required: ['startSec', 'original', 'translated'],
  },
};

const prompt = targetLang =>
  `이 오디오를 전사하고 번역하라. 원문 언어는 자동 감지한다. ` +
  `발화를 자연스러운 문단 단위로 나누고, 각 문단의 시작 시각(초)을 startSec에 넣어라. ` +
  `original에는 들리는 그대로의 원문을, translated에는 '${targetLang}' 언어 번역을 넣어라. ` +
  `음악·무음 구간은 건너뛴다.`;

const blobToBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result.split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

async function audioPart(ai, blob, mime) {
  if (blob.size <= INLINE_MAX)
    return { inlineData: { mimeType: mime, data: await blobToBase64(blob) } };
  let file = await ai.files.upload({ file: blob, config: { mimeType: mime } });
  for (let i = 0; i < 60 && file.state === 'PROCESSING'; i++) {   // 최대 ~2분 대기
    await new Promise(res => setTimeout(res, 2000));
    file = await ai.files.get({ name: file.name });
  }
  if (file.state !== 'ACTIVE') throw new Error('FILE_PROCESSING_FAILED');
  return { fileData: { mimeType: mime, fileUri: file.uri } };
}

export async function transcribeAudio({ key, blob, mime, targetLang }) {
  const ai = new GoogleGenAI({ apiKey: key });
  const part = await audioPart(ai, blob, mime);
  const res = await ai.models.generateContent({
    model: BATCH_MODEL,
    contents: [{ role: 'user', parts: [part, { text: prompt(targetLang) }] }],
    config: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
  });
  const items = JSON.parse(res.text);
  if (!Array.isArray(items)) throw new Error('BAD_TRANSCRIPT');
  return items;
}
