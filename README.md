# Jarvis UI (basic version)

## Setup
1. `cp config.example.js config.js`
2. Edit `config.js` — set `WEBHOOK_URL` to your n8n webhook URL (Production URL once the workflow is Active/Published).
3. Run locally: `npx serve .`
4. Open the printed localhost URL in Chrome or Edge (mic needs http(s)://, not a raw file:// path).

## n8n setup recap: 
- Webhook node: POST, Respond = "Using Respond to Webhook Node", CORS Allowed Origins = * (tighten to your real domain once deployed)
- AI Agent node: Prompt (User Message) = {{ $json.body.chatInput }}, Session ID = {{ $json.body.sessionId }}
- Respond to Webhook node: Respond With = JSON, Response Body = {{ JSON.stringify({ reply: $json.output }) }}

This is the plain, single-language chat + voice setup — no call/WhatsApp actions, no multi-language mic selector.
