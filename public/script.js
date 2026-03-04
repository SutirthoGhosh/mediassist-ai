'use strict';

(function () {
  const symptomForm = document.getElementById('symptom-form');
  const symptomTextarea = document.getElementById('symptoms');
  const symptomError = document.getElementById('symptom-error');
  const analyzeBtn = document.getElementById('analyze-btn');
  const clearBtn = document.getElementById('clear-btn');

  const analysisPlaceholder = document.getElementById('analysis-placeholder');
  const analysisContent = document.getElementById('analysis-content');

  const emergencyBanner = document.getElementById('emergency-banner');
  const severityText = document.getElementById('severity-text');
  const severityPill = document.getElementById('severity-pill');
  const disclaimerText = document.getElementById('disclaimer-text');
  const redFlagAlert = document.getElementById('red-flag-alert');
  const redFlagText = document.getElementById('red-flag-text');
  const riskScoreText = document.getElementById('risk-score-text');
  const riskBarFill = document.getElementById('risk-bar-fill');
  const conditionsGrid = document.getElementById('conditions-grid');

  const locateBtn = document.getElementById('locate-btn');
  const locationError = document.getElementById('location-error');
  const hospitalList = document.getElementById('hospital-list');
  const hospitalPlaceholder = document.getElementById('hospital-placeholder');
  const mapSection = document.getElementById('map-section');
  const mapCanvas = document.getElementById('map');

  let leafletMap = null;
  let markersLayer = null;
  let userMarker = null;
  let lastUserCoords = null;

  function isLeafletAvailable() {
    return typeof window.L !== 'undefined' && mapCanvas;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function ensureMapInitialized(lat, lng) {
    if (!mapSection || !mapCanvas) return null;
    if (!isLeafletAvailable()) {
      mapSection.hidden = true;
      return null;
    }

    if (!leafletMap) {
      leafletMap = window.L.map(mapCanvas, {
        zoomControl: true,
        scrollWheelZoom: false
      }).setView([lat, lng], 14);

      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(leafletMap);

      markersLayer = window.L.layerGroup().addTo(leafletMap);
      userMarker = window.L.marker([lat, lng]).addTo(markersLayer).bindPopup('Your location');
    } else {
      leafletMap.setView([lat, lng], Math.max(leafletMap.getZoom() || 14, 14));
      if (userMarker) userMarker.setLatLng([lat, lng]);
    }

    mapSection.hidden = false;
    // Leaflet needs a resize pass if the map was hidden.
    setTimeout(() => {
      if (leafletMap) leafletMap.invalidateSize();
    }, 50);

    return leafletMap;
  }

  function updateMapMarkers(lat, lng, hospitals) {
    const map = ensureMapInitialized(lat, lng);
    if (!map || !markersLayer) return;

    markersLayer.clearLayers();

    userMarker = window.L.marker([lat, lng]).addTo(markersLayer).bindPopup('Your location');

    const boundsPoints = [[lat, lng]];
    (Array.isArray(hospitals) ? hospitals : []).forEach((h) => {
      const hLat = typeof h.latitude === 'number' ? h.latitude : Number(h.latitude);
      const hLng = typeof h.longitude === 'number' ? h.longitude : Number(h.longitude);
      if (!Number.isFinite(hLat) || !Number.isFinite(hLng)) return;

      const name = h && h.name ? h.name : 'Hospital';
      const address = h && h.address ? h.address : '';
      const popupHtml = `<strong>${escapeHtml(name)}</strong><br/>${escapeHtml(address)}`;

      window.L.marker([hLat, hLng]).addTo(markersLayer).bindPopup(popupHtml);
      boundsPoints.push([hLat, hLng]);
    });

    if (boundsPoints.length > 1) {
      map.fitBounds(boundsPoints, { padding: [24, 24] });
    } else {
      map.setView([lat, lng], 14);
    }
  }

  function setButtonLoading(button, isLoading) {
    if (!button) return;
    const label = button.querySelector('.btn-label');
    const spinner = button.querySelector('.btn-spinner');
    if (isLoading) {
      button.classList.add('btn-loading');
      button.disabled = true;
      if (label) label.setAttribute('aria-hidden', 'true');
      if (spinner) spinner.style.display = 'inline-block';
    } else {
      button.classList.remove('btn-loading');
      button.disabled = false;
      if (label) label.removeAttribute('aria-hidden');
      if (spinner) spinner.style.display = 'none';
    }
  }

  function clearAnalysis() {
    analysisPlaceholder.hidden = false;
    analysisContent.hidden = true;
    analysisContent.classList.remove('is-visible');
    emergencyBanner.hidden = true;
    severityText.textContent = '';
    if (redFlagAlert) redFlagAlert.hidden = true;
    if (redFlagText) redFlagText.textContent = '';
    if (riskScoreText) riskScoreText.textContent = '0';
    if (riskBarFill) {
      riskBarFill.style.width = '0%';
      riskBarFill.classList.remove('risk-green', 'risk-orange', 'risk-red');
      riskBarFill.classList.add('risk-green');
    }
    if (conditionsGrid) conditionsGrid.innerHTML = '';
    disclaimerText.textContent = '';
    severityPill.classList.remove('severity-low', 'severity-medium', 'severity-high');
  }

  function validateSymptoms() {
    const value = symptomTextarea.value.trim();
    if (!value) {
      symptomError.textContent = 'Please describe your symptoms before analyzing.';
      symptomTextarea.focus();
      return false;
    }
    if (value.length < 5) {
      symptomError.textContent = 'Please provide a bit more detail (at least 5 characters).';
      symptomTextarea.focus();
      return false;
    }
    if (value.length > 500) {
      symptomError.textContent = 'Please keep symptoms within 500 characters.';
      symptomTextarea.focus();
      return false;
    }
    symptomError.textContent = '';
    return true;
  }

  async function handleAnalyze(event) {
    event.preventDefault();
    if (!validateSymptoms()) return;

    clearAnalysis();
    setButtonLoading(analyzeBtn, true);

    try {
      const response = await fetch('/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          symptoms: symptomTextarea.value
        })
      });

      let data = null;
      try {
        data = await response.json();
      } catch (parseErr) {
        data = null;
      }

      if (!response.ok) {
        symptomError.textContent =
          data && data.error ? data.error : 'Unable to analyze symptoms at the moment. Please try again.';
        return;
      }

      renderAnalysis(data);
    } catch (err) {
      console.error('Analyze error:', err);
      symptomError.textContent =
        'A network or server error occurred while analyzing symptoms. Please try again.';
    } finally {
      setButtonLoading(analyzeBtn, false);
    }
  }

  function renderAnalysis(result) {
    if (!result) {
      symptomError.textContent = 'Received an empty response. Please try again.';
      return;
    }

    analysisPlaceholder.hidden = true;
    analysisContent.hidden = false;
    // Smooth reveal
    requestAnimationFrame(() => {
      analysisContent.classList.add('is-visible');
    });

    const severity = (result.severityLevel || 'LOW').toUpperCase();
    severityText.textContent = severity;
    severityPill.classList.remove('severity-low', 'severity-medium', 'severity-high');
    if (severity === 'HIGH') {
      severityPill.classList.add('severity-high');
    } else if (severity === 'MEDIUM') {
      severityPill.classList.add('severity-medium');
    } else {
      severityPill.classList.add('severity-low');
    }

    const isEmergency = severity === 'HIGH';
    emergencyBanner.hidden = !isEmergency;

    if (redFlagAlert) {
      const triggered = Boolean(result.redFlagTriggered);
      redFlagAlert.hidden = !triggered;
      if (triggered) {
        const triggers = Array.isArray(result.redFlagTriggers) ? result.redFlagTriggers : [];
        redFlagText.textContent = triggers.length
          ? `Triggered: ${triggers.join(', ')}. Please seek urgent medical care.`
          : 'Please seek urgent medical care.';
      } else {
        redFlagText.textContent = '';
      }
    }

    const riskScore = typeof result.riskScore === 'number' ? result.riskScore : 0;
    if (riskScoreText) riskScoreText.textContent = String(Math.round(riskScore));
    if (riskBarFill) {
      riskBarFill.classList.remove('risk-green', 'risk-orange', 'risk-red');
      if (riskScore <= 40) riskBarFill.classList.add('risk-green');
      else if (riskScore <= 70) riskBarFill.classList.add('risk-orange');
      else riskBarFill.classList.add('risk-red');
      // Animate fill
      requestAnimationFrame(() => {
        riskBarFill.style.width = `${Math.max(0, Math.min(100, riskScore))}%`;
      });
    }

    if (conditionsGrid) {
      conditionsGrid.innerHTML = '';
      const topConditions = Array.isArray(result.topConditions) ? result.topConditions : [];
      topConditions.slice(0, 2).forEach((cond, idx) => {
        const card = document.createElement('div');
        card.className = 'condition-card';

        const top = document.createElement('div');
        top.className = 'condition-top';

        const title = document.createElement('h4');
        title.className = 'condition-name';
        title.textContent = cond && cond.condition ? cond.condition : `Condition ${idx + 1}`;

        const conf = document.createElement('div');
        conf.className = 'confidence-chip';
        const confPct =
          cond && typeof cond.confidencePercent === 'number' ? Math.round(cond.confidencePercent) : 0;
        conf.textContent = `Confidence: ${confPct}%`;

        top.appendChild(title);
        top.appendChild(conf);

        const meta = document.createElement('div');
        meta.className = 'condition-meta';

        const specialist = document.createElement('div');
        specialist.className = 'condition-meta-line';
        specialist.innerHTML = `<strong>Specialist:</strong> ${cond.specialist || 'General Physician'}`;

        const condSev = document.createElement('div');
        condSev.className = 'condition-meta-line';
        condSev.innerHTML = `<strong>Condition severity:</strong> ${(cond.severity || 'LOW').toUpperCase()}`;

        meta.appendChild(specialist);
        meta.appendChild(condSev);

        const matched = Array.isArray(cond.matchedKeywords) ? cond.matchedKeywords : [];
        if (matched.length) {
          const matchedWrap = document.createElement('div');
          matchedWrap.className = 'condition-meta-line';
          matchedWrap.innerHTML = `<strong>Matched keywords:</strong>`;
          const ul = document.createElement('ul');
          ul.className = 'pill-list pill-list-soft';
          matched.slice(0, 8).forEach((kw) => {
            const li = document.createElement('li');
            li.textContent = kw;
            ul.appendChild(li);
          });
          meta.appendChild(matchedWrap);
          meta.appendChild(ul);
        }

        const meds = Array.isArray(cond.genericMedicines) ? cond.genericMedicines : [];
        if (meds.length) {
          const medsTitle = document.createElement('div');
          medsTitle.className = 'condition-meta-line';
          medsTitle.innerHTML =
            '<strong>Generic medicine names:</strong> (No dosage advice provided)';

          const medList = document.createElement('ul');
          medList.className = 'pill-list';
          meds.forEach((m) => {
            const li = document.createElement('li');
            li.textContent = m;
            medList.appendChild(li);
          });
          meta.appendChild(medsTitle);
          meta.appendChild(medList);
        }

        const linksWrap = document.createElement('div');
        linksWrap.className = 'condition-links';
        const linksTitle = document.createElement('div');
        linksTitle.className = 'condition-meta-line';
        linksTitle.innerHTML = '<strong>Search medicines online:</strong>';

        const grid = document.createElement('div');
        grid.className = 'link-grid';

        const a1 = document.createElement('a');
        a1.className = 'link-card';
        a1.target = '_blank';
        a1.rel = 'noopener noreferrer';
        a1.href = cond.medicineLinks && cond.medicineLinks.tata1mg ? cond.medicineLinks.tata1mg : '#';
        a1.innerHTML = '<span class="link-title">Tata 1mg</span><span class="link-subtitle">External website</span>';

        const a2 = document.createElement('a');
        a2.className = 'link-card';
        a2.target = '_blank';
        a2.rel = 'noopener noreferrer';
        a2.href =
          cond.medicineLinks && cond.medicineLinks.pharmeasy ? cond.medicineLinks.pharmeasy : '#';
        a2.innerHTML =
          '<span class="link-title">PharmEasy</span><span class="link-subtitle">External website</span>';

        grid.appendChild(a1);
        grid.appendChild(a2);

        linksWrap.appendChild(linksTitle);
        linksWrap.appendChild(grid);

        card.appendChild(top);
        card.appendChild(meta);
        card.appendChild(linksWrap);

        conditionsGrid.appendChild(card);
      });
    }

    if (result.disclaimer) {
      disclaimerText.textContent = result.disclaimer;
    }
  }

  function handleClear() {
    symptomTextarea.value = '';
    symptomError.textContent = '';
    clearAnalysis();
  }

  function handleLocateClick() {
    locationError.textContent = '';
    if (!navigator.geolocation) {
      locationError.textContent =
        'Geolocation is not supported by this browser. You can still manually search for hospitals online.';
      return;
    }

    setButtonLoading(locateBtn, true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        lastUserCoords = { lat, lng };
        fetchHospitals(lat, lng);
      },
      (error) => {
        console.error('Geolocation error:', error);
        setButtonLoading(locateBtn, false);
        switch (error.code) {
          case error.PERMISSION_DENIED:
            locationError.textContent =
              'Location permission was denied. Please enable it in your browser if you want to simulate nearby hospitals.';
            break;
          case error.POSITION_UNAVAILABLE:
            locationError.textContent =
              'Location information is currently unavailable. Please try again in a few moments.';
            break;
          case error.TIMEOUT:
            locationError.textContent =
              'Location request timed out. Please ensure you have a stable connection and try again.';
            break;
          default:
            locationError.textContent =
              'An unexpected location error occurred. Please try again or manually search for hospitals near you.';
        }
      },
      { timeout: 10000 }
    );
  }

  async function fetchHospitals(lat, lng) {
    try {
      const response = await fetch('/hospitals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          latitude: lat,
          longitude: lng
        })
      });

      const data = await response.json();

      if (!response.ok) {
        locationError.textContent =
          data && data.error
            ? data.error
            : 'Unable to fetch nearby hospitals at the moment. Please try again.';
        return;
      }

      renderHospitals(data, { lat, lng });
    } catch (err) {
      console.error('Hospitals error:', err);
      locationError.textContent =
        'A network or server error occurred while fetching hospitals. Please try again.';
    } finally {
      setButtonLoading(locateBtn, false);
    }
  }

  function renderHospitals(data, userCoords) {
    const hospitals = (data && data.hospitals) || [];
    hospitalList.innerHTML = '';

    if (!hospitals.length) {
      hospitalPlaceholder.textContent =
        'No hospitals were found nearby. Please search manually for hospitals close to you.';
      hospitalPlaceholder.hidden = false;
      hospitalList.hidden = true;
      if (mapSection) mapSection.hidden = true;
    } else {
      hospitalPlaceholder.hidden = true;
      hospitalList.hidden = false;

      hospitals.forEach((h) => {
        const li = document.createElement('li');
        li.className = 'hospital-item';

        const name = document.createElement('div');
        name.className = 'hospital-name';
        name.textContent = h.name;

        const address = document.createElement('div');
        address.className = 'hospital-address';
        address.textContent = h.address;

        const meta = document.createElement('div');
        meta.className = 'hospital-meta';

        const typeChip = document.createElement('span');
        typeChip.className = 'hospital-chip';
        typeChip.textContent = 'Hospital';

        const distanceChip = document.createElement('span');
        distanceChip.className = 'hospital-distance';
        if (typeof h.distanceKm === 'number') {
          distanceChip.textContent = `${h.distanceKm.toFixed(2)} km`;
        } else {
          distanceChip.textContent = 'Distance unavailable';
        }

        meta.appendChild(typeChip);
        meta.appendChild(distanceChip);

        li.appendChild(name);
        li.appendChild(address);
        li.appendChild(meta);

        hospitalList.appendChild(li);
      });

      if (userCoords && Number.isFinite(userCoords.lat) && Number.isFinite(userCoords.lng)) {
        updateMapMarkers(userCoords.lat, userCoords.lng, hospitals);
      } else if (lastUserCoords) {
        updateMapMarkers(lastUserCoords.lat, lastUserCoords.lng, hospitals);
      }
    }

    if (data && data.disclaimer) {
      locationError.textContent = data.disclaimer;
      locationError.style.color = '#6b7280';
    }
  }

  if (symptomForm) {
    symptomForm.addEventListener('submit', handleAnalyze);
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', handleClear);
  }

  if (locateBtn) {
    locateBtn.addEventListener('click', handleLocateClick);
  }
})();

