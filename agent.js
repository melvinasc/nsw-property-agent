/**
 * agent.js — AI Agent orchestration
 *
 * All 5 data sources run through Cloudflare Worker (no CORS issues)
 * AI: Hugging Face free tier → smart rule-based fallback
 */

const HF_MODELS = [
  "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3",
  "https://api-inference.huggingface.co/models/HuggingFaceH4/zephyr-7b-beta",
  "https://api-inference.huggingface.co/models/tiiuae/falcon-7b-instruct",
];

async function runAgent() {
  const budget       = parseInt(document.getElementById("budget").value);
  const propertyType = document.getElementById("property-type").value;
  const bedrooms     = document.getElementById("bedrooms").value;
  const suburb       = document.getElementById("suburb-pref").value.trim();

  if (!budget || budget < 100000) {
    alert("Please enter a valid budget (min $100,000).");
    return;
  }

  document.getElementById("results-section").style.display = "block";
  document.getElementById("tabs").style.display            = "none";
  document.getElementById("agent-log").style.display       = "block";
  document.getElementById("log-steps").innerHTML           = "";
  document.getElementById("search-btn").disabled           = true;
  document.getElementById("search-btn").textContent        = "Agent running…";
  document.getElementById("results-section").scrollIntoView({ behavior: "smooth" });

  const ctx = { budget, propertyType, bedrooms, suburb };

  try {
    // STEP 1 — NSW Gov
    logStep("Connecting to NSW Government Open Data…", "running");
    const nswData = await DataLayer.fetchNSWGovData(ctx);
    logStepDone(`NSW Gov: ${nswData.length} records fetched`);

    // STEP 2 — All 4 listing sites via Cloudflare Worker (parallel, no CORS)
    logStep("Fetching from Domain · Homely · property.com.au · realestate.com.au via proxy…", "running");
    const [domainData, homelyData, propertyData, reaData] = await Promise.allSettled([
      DataLayer.fetchDomainData(ctx),
      DataLayer.fetchHomelyData(ctx),
      DataLayer.fetchPropertyComAu(ctx),
      DataLayer.fetchREA(ctx),
    ]).then(results => results.map(r => r.status === "fulfilled" ? r.value : []));

    const liveCount = [...domainData, ...homelyData, ...propertyData, ...reaData]
      .filter(p => p.live).length;
    logStepDone(`Listings: ${domainData.length} Domain · ${homelyData.length} Homely · ${propertyData.length} property.com.au · ${reaData.length} REA (${liveCount} live)`);

    // STEP 3 — Suburbs
    logStep("Analysing suburb affordability…", "running");
    const suburbData = await DataLayer.fetchSuburbData(budget);
    logStepDone(`Suburbs: ${suburbData.length} areas identified`);

    // STEP 4 — Trends
    logStep("Building price trend data…", "running");
    const trendData = DataLayer.buildTrendData(budget, suburb);
    logStepDone("Price trend data ready (2020–2025)");

    // STEP 5 — AI summary
    logStep("Generating AI property briefing…", "running");
    const allListings = [...nswData, ...domainData, ...homelyData, ...propertyData, ...reaData];
    const summary     = await callHuggingFace({ ctx, allListings, suburbData });
    logStepDone("AI analysis complete");

    // STEP 6 — Render
    logStep("Rendering results…", "running");
    const allProperties = deduplicateAndRank(allListings, budget);
    UI.renderProperties(allProperties);
    UI.renderSuburbs(suburbData, budget);
    UI.renderTrends(trendData);
    UI.renderSummary(summary);
    logStepDone(`Done — ${allProperties.length} properties displayed`);

    document.getElementById("tabs").style.display = "flex";
    document.getElementById("agent-log").querySelector(".agent-log-header").innerHTML =
      '<span style="color:#4ade80">✓</span> Agent complete';

  } catch (err) {
    logStep("Error: " + err.message, "error");
    console.error(err);
  } finally {
    document.getElementById("search-btn").disabled = false;
    document.getElementById("search-btn").innerHTML = '<span class="btn-icon">⬡</span> Search again';
  }
}

// ─── Hugging Face AI ──────────────────────────────────────────
async function callHuggingFace({ ctx, allListings, suburbData }) {
  const prompt = buildPrompt({ ctx, allListings, suburbData });
  const body   = JSON.stringify({
    inputs:     prompt,
    parameters: { max_new_tokens: 500, temperature: 0.5, do_sample: true, return_full_text: false },
    options:    { wait_for_model: true, use_cache: false },
  });

  for (const modelUrl of HF_MODELS) {
    try {
      let res = await fetch(modelUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (res.status === 503) {
        const d    = await res.json();
        const wait = Math.min((d.estimated_time || 20) * 1000, 25000);
        logStep(`AI model loading, waiting ${Math.round(wait/1000)}s…`, "running");
        await sleep(wait);
        res = await fetch(modelUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      }
      if (!res.ok || res.status === 429) continue;
      const data = await res.json();
      const text = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text;
      if (text?.length > 100) return cleanSummary(text);
    } catch (e) { console.warn("HF model failed:", e.message); }
  }
  return buildSmartSummary({ ctx, allListings, suburbData });
}

function buildPrompt({ ctx, allListings, suburbData }) {
  const budget   = formatPrice(ctx.budget);
  const topProps = allListings.filter(p => p.live).slice(0, 5).map(p =>
    `- ${p.address}: ${p.priceDisplay} (${p.type}${p.bedrooms ? ", " + p.bedrooms + " bed" : ""}) via ${p.source}`
  ).join("\n") || allListings.slice(0, 5).map(p =>
    `- ${p.address}: ${p.priceDisplay} (${p.type})`
  ).join("\n");
  const topSubs = suburbData.slice(0, 4).map(s =>
    `- ${s.name} (${s.region}): median ${formatPrice(s.medianPrice)}, +${s.growth}% growth`
  ).join("\n");

  return `[INST] You are a helpful NSW property advisor. Budget: ${budget}. Type: ${ctx.propertyType === "all" ? "any" : ctx.propertyType}${ctx.suburb ? ", near " + ctx.suburb : ""}.

Live listings from Domain, Homely, property.com.au and realestate.com.au:
${topProps}

Top affordable suburbs:
${topSubs}

Write a 3-paragraph plain-English property briefing: what the budget buys in NSW, best 2 suburbs, and 2 practical buyer tips. Friendly Australian tone. [/INST]

With a budget of ${budget},`;
}

function cleanSummary(text) {
  return text
    .replace(/^[\s\S]*?(?=With a budget|Your budget|At \$|Based on)/i, "")
    .replace(/\[INST\][\s\S]*?\[\/INST\]/g, "")
    .replace(/<s>|<\/s>/g, "")
    .trim() || text.trim();
}

function buildSmartSummary({ ctx, allListings, suburbData }) {
  const budget       = formatPrice(ctx.budget);
  const topSuburb    = suburbData[0]?.name     || "Western Sydney";
  const topRegion    = suburbData[0]?.region   || "Western Sydney";
  const topMedian    = suburbData[0]?.medianPrice ? formatPrice(suburbData[0].medianPrice) : "below budget";
  const topGrowth    = suburbData[0]?.growth   || "4.2";
  const secondSuburb = suburbData[1]?.name     || "Central Coast";
  const secondRegion = suburbData[1]?.region   || "NSW";
  const secondMedian = suburbData[1]?.medianPrice ? formatPrice(suburbData[1].medianPrice) : "within budget";
  const secondGrowth = suburbData[1]?.growth   || "5.1";
  const propType     = ctx.propertyType === "all" ? "property" : ctx.propertyType;
  const bedroomNote  = ctx.bedrooms !== "any" ? ` with ${ctx.bedrooms}+ bedrooms` : "";
  const liveCount    = allListings.filter(p => p.live).length;
  const sourceNote   = liveCount > 0
    ? `Data was pulled from ${liveCount} live listings across Domain, Homely, property.com.au and realestate.com.au`
    : "Data is based on current NSW Government property sales records and suburb median pricing";

  return `With a budget of ${budget}, you have genuine options across NSW's property market right now. ${sourceNote}, giving you a real picture of what's available for a ${propType}${bedroomNote} in your price range.

${topSuburb} (${topRegion}) stands out as a top pick with a median of ${topMedian} and ${topGrowth}% annual growth — solid value with good infrastructure and commute links. ${secondSuburb} in ${secondRegion} is another strong option at ${secondMedian}, recording ${secondGrowth}% growth and offering a lifestyle that punches well above its price point. Both suburbs give you negotiating room that the inner-city market simply doesn't.

Two tips to make the most of your budget: first, get formal pre-approval before attending any inspections — sellers respond faster to buyers who can move quickly. Second, look for properties listed 30+ days on market, where vendors are often open to negotiating 4–8% below asking price, potentially freeing up funds for renovations.`;
}

// ─── Deduplication & ranking ──────────────────────────────────
function deduplicateAndRank(properties, budget) {
  const seen = new Set();
  return properties
    .filter(p => {
      if (p.price && p.price > budget * 1.05) return false;
      const key = p.address?.toLowerCase().replace(/\s/g, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      // Live results first
      if (a.live !== b.live) return a.live ? -1 : 1;
      return Math.abs((a.price || budget) - budget) - Math.abs((b.price || budget) - budget);
    })
    .slice(0, 24);
}

// ─── Helpers ──────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
let _stepEl = null;
function logStep(msg, state = "running") {
  const el = document.createElement("div");
  el.className = `log-step ${state}`;
  el.textContent = msg;
  document.getElementById("log-steps").appendChild(el);
  _stepEl = el;
  el.scrollIntoView({ block: "nearest" });
}
function logStepDone(msg) {
  if (_stepEl) { _stepEl.className = "log-step done"; _stepEl.textContent = msg; }
}
function formatPrice(n) {
  return n ? `$${Math.round(n).toLocaleString("en-AU")}` : "Contact agent";
}

window.runAgent    = runAgent;
window.formatPrice = formatPrice;
