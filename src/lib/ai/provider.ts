/**
 * Вызов LLM. Работает ТОЛЬКО на сервере: ключи читаются из process.env
 * без префикса NEXT_PUBLIC_, поэтому в браузер не попадают.
 */

export type Provider = 'gemini' | 'groq' | 'ollama';

export function currentProvider(): Provider {
  const v = process.env.AI_PROVIDER?.trim();
  return v === 'groq' || v === 'ollama' ? v : 'gemini';
}

const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'llama3.2';

async function failure(name: string, res: Response): Promise<Error> {
  const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
  return new Error(`${name} ${res.status}: ${body}`);
}

export async function callLLM(system: string, user: string): Promise<string> {
  if (currentProvider() === 'ollama') {
    // Локальная модель: данные не покидают вашу машину/сервер. Ollama должен быть запущен.
    const base = (process.env.OLLAMA_URL?.trim() || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
    let res: Response;
    try {
      res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL,
          stream: false,
          options: { temperature: 0.3 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new Error(`Ollama недоступен по адресу ${base}. Запущен ли он (ollama serve)?`);
    }
    if (!res.ok) throw await failure('Ollama', res);
    const data = await res.json();
    return data.message?.content ?? '';
  }

  if (currentProvider() === 'groq') {
    const key = process.env.GROQ_API_KEY?.trim();
    if (!key) throw new Error('GROQ_API_KEY не задан в .env (после правки перезапустите npm run dev)');
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL,
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw await failure('Groq', res);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY не задан в .env (после правки перезапустите npm run dev)');
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.3 },
      }),
    },
  );
  if (!res.ok) throw await failure('Gemini', res);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}
