// server.js - Main entry point for the backend server
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Import services
// const geminiService = require('./geminiService');
// const ambulanceService = require('./ambulanceService');
// const crisisGuideService = require('./crisisGuideService');
// const disasterAlertService = require('./disasterAlertService');
// const healthService = require('./healthService');
// const notifyService = require('./notifyService');

// Routes will be added here

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
