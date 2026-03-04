const express = require('express');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

const DISCLAIMER_TEXT =
  'This system is for informational purposes only and is NOT a medical diagnosis. Always consult a licensed doctor for medical advice or emergencies.';

// Basic security / parsing middleware
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Rate limit ONLY the hospital lookup route (per IP)
const hospitalsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please wait a minute and try again.',
    disclaimer: DISCLAIMER_TEXT
  }
});

app.use('/hospitals', hospitalsLimiter);

// API routes
app.use('/', apiRoutes);

// 404 handler for API (non-static)
app.use((req, res, next) => {
  if (req.path.startsWith('/analyze') || req.path.startsWith('/hospitals')) {
    return res.status(404).json({
      error: 'Endpoint not found',
      disclaimer: DISCLAIMER_TEXT
    });
  }
  next();
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    disclaimer: DISCLAIMER_TEXT
  });
});

app.listen(PORT, () => {
  console.log(`MediAssist AI server running on http://localhost:${PORT}`);
});

