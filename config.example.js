// config.example.js — copy this file to config.js and fill in your real values.
// config.js is git-ignored, so your real webhook URL never gets pushed.

window.JARVIS_CONFIG = {
  // Your n8n webhook URL. Use the Production URL once your workflow is Active/Published, e.g.
  // "http://localhost:5678/webhook/jarvis"
  WEBHOOK_URL: "http://localhost:5678/webhook/jarvis",

  // If true, Jarvis will speak replies aloud using the browser's speech synthesis
  SPEAK_REPLIES: true,
};
