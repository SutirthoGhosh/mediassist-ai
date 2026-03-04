const DISCLAIMER_TEXT =
  'This system is for informational purposes only and is NOT a medical diagnosis. Always consult a licensed doctor for medical advice or emergencies.';

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeSymptomsInput(input) {
  if (typeof input !== 'string') return '';
  let text = input.trim();

  // Strip HTML tags
  text = text.replace(/<[^>]*>/g, ' ');

  // Hard limit length (backend requirement)
  if (text.length > 500) {
    text = text.slice(0, 500);
  }

  // Remove special characters except commas and spaces
  // Keep letters/numbers, commas, and spaces only.
  text = text.replace(/[^a-zA-Z0-9, ]+/g, ' ');

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

function detectRedFlags(sanitizedLower) {
  const hasChestPain = sanitizedLower.includes('chest pain');
  const hasLeftArmPain =
    sanitizedLower.includes('left arm pain') ||
    sanitizedLower.includes('pain in left arm') ||
    (sanitizedLower.includes('left arm') && sanitizedLower.includes('arm pain'));

  const breathingDifficulty =
    sanitizedLower.includes('breathing difficulty') ||
    sanitizedLower.includes('difficulty breathing') ||
    sanitizedLower.includes('shortness of breath') ||
    sanitizedLower.includes('cannot breathe') ||
    sanitizedLower.includes('cant breathe');

  const unconscious =
    sanitizedLower.includes('unconscious') ||
    sanitizedLower.includes('passed out') ||
    sanitizedLower.includes('not conscious');

  const severeBleeding =
    sanitizedLower.includes('severe bleeding') ||
    sanitizedLower.includes('heavy bleeding') ||
    sanitizedLower.includes('bleeding heavily');

  const chestPlusArm = hasChestPain && hasLeftArmPain;

  const redFlagTriggered = Boolean(chestPlusArm || breathingDifficulty || unconscious || severeBleeding);

  const triggers = [];
  if (chestPlusArm) triggers.push('chest pain + left arm pain');
  if (breathingDifficulty) triggers.push('breathing difficulty');
  if (unconscious) triggers.push('unconscious');
  if (severeBleeding) triggers.push('severe bleeding');

  return { redFlagTriggered, triggers };
}

function buildMedicineLinks(conditionName, genericMedicines) {
  const medicines = Array.isArray(genericMedicines) ? genericMedicines : [];
  const query = encodeURIComponent(
    medicines.length ? `${conditionName} ${medicines.join(' ')}` : conditionName
  );

  return {
    tata1mg: `https://www.1mg.com/search/all?name=${query}`,
    pharmeasy: `https://pharmeasy.in/search/all?name=${query}`
  };
}

function scoreConditions(sanitizedLower, conditions) {
  const results = [];

  for (const condition of conditions) {
    const keywords = Array.isArray(condition.keywords) ? condition.keywords : [];
    const weightPerKeyword =
      typeof condition.weightPerKeyword === 'number' && Number.isFinite(condition.weightPerKeyword)
        ? condition.weightPerKeyword
        : 10;

    const matchedKeywords = [];
    for (const kw of keywords) {
      if (typeof kw !== 'string') continue;
      const needle = kw.toLowerCase();
      if (!needle) continue;
      if (sanitizedLower.includes(needle)) matchedKeywords.push(kw);
    }

    const matchedCount = matchedKeywords.length;
    const score = matchedCount * weightPerKeyword;
    const maxScore = keywords.length * weightPerKeyword;
    const confidencePercent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

    results.push({
      condition: condition.condition || 'Unknown',
      keywords,
      weightPerKeyword,
      severity: (condition.severity || 'LOW').toUpperCase(),
      specialist: condition.specialist || 'General Physician',
      emergency: Boolean(condition.emergency),
      genericMedicines: Array.isArray(condition.genericMedicines) ? condition.genericMedicines : [],
      matchedKeywords,
      matchedCount,
      score,
      confidencePercent
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.confidencePercent !== a.confidencePercent) return b.confidencePercent - a.confidencePercent;
    return b.matchedCount - a.matchedCount;
  });

  return results;
}

function computeRiskScore({ severityLevel, topConfidencePercent, topStrengthPercent, redFlagTriggered }) {
  // Strength from match quality; prefer strength percent if available.
  const raw = Number.isFinite(topStrengthPercent)
    ? topStrengthPercent
    : Number.isFinite(topConfidencePercent)
      ? topConfidencePercent
      : 0;

  let riskScore = clampNumber(Math.round(raw), 0, 100);

  // Constrain into requested bands based on severity level.
  const sev = (severityLevel || 'LOW').toUpperCase();
  if (sev === 'LOW') {
    riskScore = clampNumber(riskScore, 0, 40);
  } else if (sev === 'MEDIUM') {
    riskScore = clampNumber(riskScore, 41, 70);
  } else {
    riskScore = clampNumber(riskScore, 71, 100);
  }

  if (redFlagTriggered) {
    riskScore = Math.max(riskScore, 90);
  }

  return riskScore;
}

function analyzeSymptoms(symptoms, conditions) {
  const sanitized = sanitizeSymptomsInput(symptoms);
  const sanitizedLower = sanitized.toLowerCase();

  if (!sanitized || !sanitizedLower.trim()) {
    return {
      topConditions: [],
      redFlagTriggered: false,
      redFlagTriggers: [],
      severityLevel: 'LOW',
      riskScore: 0,
      disclaimer: DISCLAIMER_TEXT
    };
  }

  const { redFlagTriggered, triggers } = detectRedFlags(sanitizedLower);
  const scored = scoreConditions(sanitizedLower, Array.isArray(conditions) ? conditions : []);

  const matchedOnly = scored.filter((x) => x.matchedCount > 0);
  let topTwo = matchedOnly.slice(0, 2);

  if (topTwo.length === 0) {
    // If nothing matched, return low-risk generic suggestions (still not a diagnosis).
    topTwo = [
      {
        condition: 'General check-up recommended',
        severity: 'LOW',
        specialist: 'General Physician',
        emergency: false,
        genericMedicines: [],
        matchedKeywords: [],
        matchedCount: 0,
        score: 0,
        confidencePercent: 0,
        medicineLinks: buildMedicineLinks('General check-up', [])
      },
      {
        condition: 'Monitor symptoms and rest',
        severity: 'LOW',
        specialist: 'General Physician',
        emergency: false,
        genericMedicines: [],
        matchedKeywords: [],
        matchedCount: 0,
        score: 0,
        confidencePercent: 0,
        medicineLinks: buildMedicineLinks('Monitor symptoms', [])
      }
    ];
  }

  // Attach per-condition medicine links.
  topTwo = topTwo.map((c) => ({
    condition: c.condition,
    severity: (c.severity || 'LOW').toUpperCase(),
    specialist: c.specialist,
    emergency: Boolean(c.emergency),
    genericMedicines: Array.isArray(c.genericMedicines) ? c.genericMedicines : [],
    matchedKeywords: Array.isArray(c.matchedKeywords) ? c.matchedKeywords : [],
    matchedCount: typeof c.matchedCount === 'number' ? c.matchedCount : 0,
    score: typeof c.score === 'number' ? c.score : 0,
    confidencePercent: typeof c.confidencePercent === 'number' ? c.confidencePercent : 0,
    medicineLinks: buildMedicineLinks(c.condition, c.genericMedicines)
  }));

  // Severity is based on best condition unless red flag triggers.
  const best = topTwo[0];
  let severityLevel = (best && best.severity) || 'LOW';
  if (redFlagTriggered) severityLevel = 'HIGH';

  // Match strength percent based on best condition's score vs theoretical max for that rule.
  let topStrengthPercent = best ? best.confidencePercent : 0;

  const riskScore = computeRiskScore({
    severityLevel,
    topConfidencePercent: best ? best.confidencePercent : 0,
    topStrengthPercent,
    redFlagTriggered
  });

  return {
    topConditions: topTwo,
    redFlagTriggered,
    redFlagTriggers: triggers,
    severityLevel,
    riskScore,
    disclaimer: DISCLAIMER_TEXT
  };
}

module.exports = {
  DISCLAIMER_TEXT,
  sanitizeSymptomsInput,
  analyzeSymptoms
};

