const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const { DISCLAIMER_TEXT, analyzeSymptoms, sanitizeSymptomsInput } = require('../utils/analyzer');
const { analyzeSymptomsWithOpenAI, DEFAULT_DISCLAIMER } = require('../services/aiService');

const router = express.Router();

// Load condition mappings once at startup
const conditionsPath = path.join(__dirname, '..', 'data', 'conditions.json');
let conditionRules = [];

try {
  const fileContent = fs.readFileSync(conditionsPath, 'utf8');
  conditionRules = JSON.parse(fileContent);
} catch (err) {
  console.error('Failed to load conditions.json:', err);
  conditionRules = [];
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function computeRiskScore({ severityLevel, topConfidencePercent, redFlagTriggered }) {
  let score = clampNumber(Math.round(Number(topConfidencePercent) || 0), 0, 100);
  const sev = String(severityLevel || 'LOW').toUpperCase();

  if (sev === 'LOW') score = clampNumber(score, 0, 40);
  else if (sev === 'MEDIUM') score = clampNumber(score, 41, 70);
  else score = clampNumber(score, 71, 100);

  if (redFlagTriggered) score = Math.max(score, 90);
  return score;
}

function buildMedicineLinks(conditionName, genericMedicines) {
  const meds = Array.isArray(genericMedicines) ? genericMedicines : [];
  const query = encodeURIComponent(meds.length ? `${conditionName} ${meds.join(' ')}` : conditionName);
  return {
    tata1mg: `https://www.1mg.com/search/all?name=${query}`,
    pharmeasy: `https://pharmeasy.in/search/all?name=${query}`
  };
}

// POST /analyze
router.post('/analyze', (req, res, next) => {
  (async () => {
    const { symptoms } = req.body || {};

    if (typeof symptoms !== 'string') {
      return res.status(400).json({
        error: 'Symptoms must be provided as text.',
        disclaimer: DISCLAIMER_TEXT
      });
    }

    if (!symptoms.trim()) {
      return res.status(400).json({
        error: 'Symptoms cannot be empty or whitespace-only.',
        disclaimer: DISCLAIMER_TEXT
      });
    }

    if (symptoms.length > 500) {
      return res.status(413).json({
        error: 'Symptoms text is too long. Please keep it within 500 characters.',
        disclaimer: DISCLAIMER_TEXT
      });
    }

    const sanitized = sanitizeSymptomsInput(symptoms);
    if (!sanitized) {
      return res.status(400).json({
        error:
          'Your input became empty after sanitization. Please describe symptoms using letters, numbers, commas, and spaces only.',
        disclaimer: DISCLAIMER_TEXT
      });
    }

    // Safety logging: avoid printing raw symptoms in production.
    if (process.env.NODE_ENV !== 'production') {
      console.log('[analyze] request length:', symptoms.length);
    } else {
      console.log('[analyze] request received');
    }

    const sanitizedLower = sanitized.toLowerCase();
    const { redFlagTriggered, triggers } = detectRedFlags(sanitizedLower);

    try {
      const ai = await analyzeSymptomsWithOpenAI(sanitized);

      let severityLevel = String(ai.severityLevel || 'LOW').toUpperCase();
      if (redFlagTriggered) severityLevel = 'HIGH';

      const topConditions = Array.isArray(ai.topConditions) ? ai.topConditions.slice(0, 2) : [];
      const normalizedTop = topConditions.map((c) => {
        const condition = c && c.condition ? String(c.condition) : 'Unknown';
        const confidencePercent = clampNumber(Math.round(Number(c && c.confidencePercent)), 0, 100);
        const genericMedicines = [];
        return {
          condition,
          severity: String(c && c.severity ? c.severity : severityLevel).toUpperCase(),
          specialist: c && c.specialist ? String(c.specialist) : 'General Physician',
          emergency: Boolean(c && c.emergency) || severityLevel === 'HIGH' || redFlagTriggered,
          confidencePercent: Number.isFinite(confidencePercent) ? confidencePercent : 0,
          genericMedicines,
          matchedKeywords: [],
          matchedCount: 0,
          score: 0,
          medicineLinks: buildMedicineLinks(condition, genericMedicines)
        };
      });

      const bestConfidence = normalizedTop[0] ? normalizedTop[0].confidencePercent : 0;
      const riskScore = computeRiskScore({
        severityLevel,
        topConfidencePercent: bestConfidence,
        redFlagTriggered
      });

      return res.json({
        topConditions: normalizedTop.length ? normalizedTop : analyzeSymptoms(sanitized, conditionRules).topConditions,
        redFlagTriggered,
        redFlagTriggers: triggers,
        severityLevel,
        riskScore,
        disclaimer: ai.disclaimer || DEFAULT_DISCLAIMER || DISCLAIMER_TEXT
      });
    } catch (aiErr) {
      // Fallback to deterministic rule-based engine if AI is unavailable/fails.
      if (process.env.NODE_ENV !== 'production') {
        console.error('[analyze] AI failed, using fallback:', aiErr && aiErr.message ? aiErr.message : aiErr);
      } else {
        console.error('[analyze] AI failed, using fallback');
      }

      const fallback = analyzeSymptoms(sanitized, conditionRules);
      return res.json(fallback);
    }
  })().catch(next);
});

const OSM_DISCLAIMER =
  'Hospital data provided by OpenStreetMap contributors via Nominatim. Results are informational and may be incomplete or outdated.';

function toRad(value) {
  return (value * Math.PI) / 180;
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// POST /hospitals
router.post('/hospitals', (req, res, next) => {
  (async () => {
    try {
      const { latitude, longitude } = req.body || {};

      const lat = Number(latitude);
      const lng = Number(longitude);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({
          error: 'Valid latitude and longitude are required.',
          disclaimer: OSM_DISCLAIMER
        });
      }

      // Bounding box around coordinates (+/- 0.05)
      const delta = 0.05;
      const left = lng - delta;
      const right = lng + delta;
      const top = lat + delta;
      const bottom = lat - delta;

      const url = 'https://nominatim.openstreetmap.org/search';
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'MediAssistAI/1.0 (educational project)'
        },
        params: {
          q: 'hospital',
          format: 'json',
          limit: 5,
          viewbox: `${left},${top},${right},${bottom}`,
          bounded: 1
        },
        timeout: 8000,
        validateStatus: (status) => status >= 200 && status < 300
      });

      const items = Array.isArray(response.data) ? response.data : [];

      const hospitals = items.map((item) => {
        const display = typeof item.display_name === 'string' ? item.display_name : '';
        const inferredName = display ? display.split(',')[0].trim() : 'Hospital';
        const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : inferredName;

        const itemLat = Number(item.lat);
        const itemLng = Number(item.lon);

        let distanceKm = null;
        if (Number.isFinite(itemLat) && Number.isFinite(itemLng)) {
          const d = calculateDistanceKm(lat, lng, itemLat, itemLng);
          distanceKm = Number.isFinite(d) ? Number(d.toFixed(2)) : null;
        }

        return {
          name,
          address: display || 'Address not available',
          latitude: Number.isFinite(itemLat) ? itemLat : null,
          longitude: Number.isFinite(itemLng) ? itemLng : null,
          distanceKm
        };
      });

      const withDistance = hospitals.filter(
        (h) => typeof h.distanceKm === 'number' && Number.isFinite(h.distanceKm)
      );
      const withoutDistance = hospitals.filter(
        (h) => typeof h.distanceKm !== 'number' || !Number.isFinite(h.distanceKm)
      );

      const sortedHospitals = [
        ...withDistance.sort((a, b) => a.distanceKm - b.distanceKm),
        ...withoutDistance
      ].slice(0, 5);

      return res.json({
        hospitals: sortedHospitals,
        disclaimer: OSM_DISCLAIMER
      });
    } catch (err) {
      // Do not log sensitive request bodies. Log minimal diagnostic info.
      if (process.env.NODE_ENV !== 'production') {
        console.error('[hospitals] OSM request failed:', err && err.message ? err.message : err);
      } else {
        console.error('[hospitals] OSM request failed');
      }

      return res.status(502).json({
        error: 'Unable to fetch hospitals from OpenStreetMap at the moment. Please try again later.',
        disclaimer: OSM_DISCLAIMER
      });
    }
  })().catch(next);
});

module.exports = router;

