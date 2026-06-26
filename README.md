# 🏠 NSW Property Agent

An AI-powered property search agent for NSW. Enter your budget — get matching properties, suburb recommendations, price trend charts, and an AI briefing. **100% free to run.**

![NSW Property Agent](https://img.shields.io/badge/NSW-Property%20Agent-2563eb?style=flat-square) ![Free](https://img.shields.io/badge/cost-free-22c55e?style=flat-square) ![GitHub Pages](https://img.shields.io/badge/hosted%20on-GitHub%20Pages-181717?style=flat-square&logo=github)

---

## ✨ Features

- 🏡 **Live property listings** from NSW Government Open Data + Domain.com.au
- 📍 **Suburb recommendations** ranked by affordability and growth
- 📈 **Price trend charts** comparing median prices vs your budget (2020–2025)
- 🤖 **AI summary** via Google Gemini (free tier, 1,500 req/day)
- 🔍 Filter by property type, bedrooms, and suburb/area

---

## 🚀 Deploy to GitHub Pages (5 minutes, free)

### Step 1 — Fork this repo

Click **Fork** → top right of this page.

### Step 2 — Enable GitHub Pages

1. Go to your forked repo → **Settings** → **Pages**
2. Under *Source*, select **Deploy from a branch**
3. Branch: `main` | Folder: `/ (root)`
4. Click **Save**

Your site will be live at:
```
https://YOUR_USERNAME.github.io/nsw-property-agent/
```

### Step 3 — Use the app

1. Open your GitHub Pages URL
2. Enter your budget, property type, bedrooms, and preferred area
3. Click **Search properties**

No API key needed. The AI summary is powered by Hugging Face's free inference API — guests just use it directly.

---

## 📦 Project Structure

```
nsw-property-agent/
├── index.html          # Main app shell
├── css/
│   └── style.css       # All styles
├── js/
│   ├── data.js         # Data fetching (NSW Gov API + Domain)
│   ├── agent.js        # AI agent orchestration + Gemini calls
│   └── ui.js           # Rendering (properties, suburbs, chart, summary)
└── README.md
```

---

## 🔌 Data Sources (all free)

| Source | What it provides | Key needed? |
|--------|-----------------|-------------|
| [NSW Gov Open Data](https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Valuation/MapServer) | Historical property sales, Valuer General data | ❌ No |
| [Domain.com.au](https://www.domain.com.au) | Live property listings | ❌ No |
| [Hugging Face Inference API](https://huggingface.co/inference-api) | AI analysis & summary (Mistral 7B) | ❌ No |
| [corsproxy.io](https://corsproxy.io) | CORS proxy for browser fetches | ❌ No |

---

## 🛠️ Run Locally

No build step needed. Just open with a local server:

```bash
# Python
python3 -m http.server 8080

# Node.js
npx serve .

# VS Code: install Live Server extension → click "Go Live"
```

Then open [http://localhost:8080](http://localhost:8080)

---

## 🔧 Customisation

### Change the CORS proxy

`data.js` line 1 — replace `corsproxy.io` with your own:

```js
// Free options:
const CORS_PROXY = "https://corsproxy.io/?";            // corsproxy.io
const CORS_PROXY = "https://api.allorigins.win/raw?url="; // allorigins
// Or deploy a Cloudflare Worker (free tier) for reliability
```

### Use a different free AI

Replace Gemini with **Groq** (also free):

```js
// In agent.js, replace GEMINI_API and callGemini():
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
// model: "llama-3.1-8b-instant" (free tier, very fast)
// Get free key at: https://console.groq.com
```

---

## 📋 Free Tier Limits

| Service | Free limit |
|---------|-----------|
| GitHub Pages | Unlimited (public repos) |
| NSW Gov API | Unlimited |
| Domain.com.au | Unlimited (public pages) |
| Google Gemini Flash | 1,500 req/day, 1M tokens/min |
| corsproxy.io | Unlimited (community proxy) |

---

## 🙏 Acknowledgements

- Property data: NSW Government / Spatial Services
- Listings: Domain.com.au
- AI: Google Gemini (free via AI Studio)
- Charts: Chart.js
- Fonts: DM Serif Display, Inter, JetBrains Mono (Google Fonts)

---

## 📄 Licence

MIT — free to use, fork, and modify.
