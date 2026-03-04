const axios = require('axios');

const DEFAULT_DISCLAIMER =
  'This system is for informational purposes only and is NOT a medical diagnosis. Always consult a licensed doctor for medical advice or emergencies.';

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeJsonParse(maybeJsonString) {
  if (typeof maybeJsonString !== 'string') return null;
  try {
    return JSON.parse(maybeJsonString);
  } catch {
    // Attempt to extract a JSON object if the model returned extra text.
    const start = maybeJsonString.indexOf('{');
    const end = maybeJsonString.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = maybeJsonString.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeSeverity(value) {
  const v = String(value || '').toUpperCase();
  if (v === 'HIGH' || v === 'MEDIUM' || v === 'LOW') return v;
  return 'LOW';
}

function normalizeTopConditions(value) {
  const arr = Array.isArray(value) ? value : [];
  const normalized = arr.slice(0, 2).map((c) => {
    const confidencePercent = clampNumber(
      Math.round(Number(c && c.confidencePercent)),
      0,
      100
    );
    return {
      condition: typeof (c && c.condition) === 'string' && c.condition.trim() ? c.condition.trim() : 'Unknown',
      severity: normalizeSeverity(c && c.severity),
      emergency: Boolean(c && c.emergency),
      specialist:
        typeof (c && c.specialist) === 'string' && c.specialist.trim()
          ? c.specialist.trim()
          : 'General Physician',
      confidencePercent: Number.isFinite(confidencePercent) ? confidencePercent : 0
    };
  });

  // Ensure exactly 2 entries for the frontend layout.
  while (normalized.length < 2) {
    normalized.push({
      condition: 'General check-up recommended',
      severity: 'LOW',
      emergency: false,
      specialist: 'General Physician',
      confidencePercent: 0
    });
  }

  return normalized;
}

function buildPrompt(symptomsSanitized) {
  const system = [
    'You are MediAssist AI, an educational medical assistance assistant.',
    'You MUST NOT claim a confirmed diagnosis.',
    'You MUST keep outputs safe, cautious, and encourage consulting a licensed doctor.',
    'Return ONLY JSON. No markdown, no code fences, no extra text.',
    'Output must match the requested schema exactly.',
    '',
    'Schema:',
    '{',
    '  "topConditions": [',
    '    { "condition": string, "severity": "LOW|MEDIUM|HIGH", "emergency": boolean, "specialist": string, "confidencePercent": number },',
    '    { "condition": string, "severity": "LOW|MEDIUM|HIGH", "emergency": boolean, "specialist": string, "confidencePercent": number }',
    '  ],',
    '  "severityLevel": "LOW|MEDIUM|HIGH",',
    '  "emergency": boolean,',
    '  "disclaimer": string',
    '}'
  ].join('\n');

  const user = [
    'Analyze the following symptoms text and provide top 2 possible conditions with severity and recommended specialist.',
    'Do not include dosage advice.',
    'Be conservative and safety-focused.',
    '',
    `Symptoms: "${symptomsSanitized}"`
  ].join('\n');

  return { system, user };
}

async function analyzeSymptomsWithOpenAI(symptomsSanitized) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const { system, user } = buildPrompt(symptomsSanitized);

  const url = 'https://api.openai.com/v1/chat/completions';

  const response = await axios.post(
    url,
    {
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      response_format: { type: 'json_object' }
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000,
      validateStatus: (status) => status >= 200 && status < 300
    }
  );

  const content =
    response &&
    response.data &&
    Array.isArray(response.data.choices) &&
    response.data.choices[0] &&
    response.data.choices[0].message &&
    typeof response.data.choices[0].message.content === 'string'
      ? response.data.choices[0].message.content
      : '';

  const parsed = safeJsonParse(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Failed to parse JSON response from OpenAI');
  }

  const topConditions = normalizeTopConditions(parsed.topConditions);
  const severityLevel = normalizeSeverity(parsed.severityLevel);
  const emergency = Boolean(parsed.emergency) || severityLevel === 'HIGH';
  const disclaimer =
    typeof parsed.disclaimer === 'string' && parsed.disclaimer.trim() ? parsed.disclaimer.trim() : DEFAULT_DISCLAIMER;

  return {
    topConditions,
    severityLevel,
    emergency,
    disclaimer
  };
}

module.exports = {
  analyzeSymptomsWithOpenAI,
  DEFAULT_DISCLAIMER
};

