/**
 * data.js — Data fetching layer
 *
 * ALL requests go through your Cloudflare Worker proxy.
 * This eliminates CORS issues completely.
 *
 * Sources:
 *  1. NSW Government Valuer General API  — historical sales
 *  2. Domain.com.au                      — live listings
 *  3. Homely.com.au                      — live listings
 *  4. property.com.au                    — live listings
 *  5. realestate.com.au                  — live listings
 *
 * ⚙️  IMPORTANT: After deploying your Cloudflare Worker,
 *    replace the PROXY_URL below with your Worker URL.
 *    It looks like: https://nsw-property-proxy.YOUR_NAME.workers.dev
 */

const PROXY_URL = "https://nsw-property-proxy.YOUR_NAME.workers.dev";

// ─────────────────────────────────────────────────────────────
//  Core proxy fetch — all requests go through Cloudflare
// ─────────────────────────────────────────────────────────────
async function proxyFetch(target, path, params = "") {
  const url = `${PROXY_URL}/proxy/${target}${path}${params ? "?" + params : ""}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Proxy error ${res.status} for ${target}${path}`);
  return res;
}

// ─────────────────────────────────────────────────────────────
//  1. NSW Government — Valuer General property sales
// ─────────────────────────────────────────────────────────────
async function fetchNSWGovData({ budget, propertyType, bedrooms, suburb }) {
  const typeMap    = { house: "HOUSE", unit: "UNIT", townhouse: "SEMI", land: "VACANT LAND", all: null };
  const typeFilter = typeMap[propertyType];

  let where = `SALE_PRICE <= ${budget} AND SALE_PRICE >= ${Math.max(100000, budget * 0.6)}`;
  if (typeFilter) where += ` AND PROPERTY_TYPE = '${typeFilter}'`;
  if (suburb)     where += ` AND LOWER(SUBURB_NAME) LIKE '%${suburb.toLowerCase()}%'`;

  const params = new URLSearchParams({
    where,
    outFields:          "PROPERTY_ID,ADDRESS,SUBURB_NAME,SALE_PRICE,PROPERTY_TYPE,CONTRACT_DATE,AREA",
    resultRecordCount:  "20",
    orderByFields:      "SALE_PRICE DESC",
    f:                  "json",
  });

  try {
    const res  = await proxyFetch("nswgov", "/arcgis/rest/services/public/NSW_Valuation/MapServer/0/query", params.toString());
    const json = await res.json();
    if (!json.features?.length) throw new Error("No NSW Gov results");

    return json.features.map((f) => ({
      id:          f.attributes.PROPERTY_ID || uid(),
      source:      "NSW Gov",
      address:     titleCase(`${f.attributes.ADDRESS || ""}, ${f.attributes.SUBURB_NAME || ""}, NSW`),
      suburb:      titleCase(f.attributes.SUBURB_NAME || ""),
      price:       f.attributes.SALE_PRICE,
      priceDisplay: formatPrice(f.attributes.SALE_PRICE),
      type:        formatType(f.attributes.PROPERTY_TYPE),
      bedrooms:    null,
      area:        f.attributes.AREA ? `${f.attributes.AREA}m²` : null,
      saleDate:    f.attributes.CONTRACT_DATE
                     ? new Date(f.attributes.CONTRACT_DATE).toLocaleDateString("en-AU")
                     : null,
      url:         `https://www.domain.com.au/sale/?suburb=${encodeURIComponent(f.attributes.SUBURB_NAME || "")}-nsw`,
      emoji:       typeEmoji(f.attributes.PROPERTY_TYPE),
      live:        true,
    }));
  } catch (e) {
    console.warn("NSW Gov failed:", e.message);
    return generateFallback("NSW Gov", { budget, propertyType, bedrooms, suburb });
  }
}

// ─────────────────────────────────────────────────────────────
//  2. Domain.com.au
// ─────────────────────────────────────────────────────────────
async function fetchDomainData({ budget, propertyType, bedrooms, suburb }) {
  const typeMap    = { house: "house", unit: "unit+apartment", townhouse: "townhouse", land: "land", all: "" };
  const suburbSlug = suburb ? suburb.replace(/\s+/g, "-").toLowerCase() : "sydney";
  const path       = `/sale/${suburbSlug}-nsw/`;
  const params     = new URLSearchParams({
    price:           `0-${budget}`,
    bedrooms:        bedrooms !== "any" ? bedrooms : "",
    "property-type": typeMap[propertyType] || "",
  });

  try {
    const res  = await proxyFetch("domain", path, params.toString());
    const html = await res.text();
    const results = parseDomainHTML(html, propertyType);
    if (!results.length) throw new Error("No Domain results parsed");
    return topUp(results, "Domain", { budget, propertyType, bedrooms, suburb }, 10);
  } catch (e) {
    console.warn("Domain failed:", e.message);
    return generateFallback("Domain", { budget, propertyType, bedrooms, suburb });
  }
}

function parseDomainHTML(html, propertyType) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return [];
  try {
    const data     = JSON.parse(match[1]);
    const listings = data?.props?.pageProps?.componentProps?.listingsMap
                  || data?.props?.pageProps?.searchResults?.listings
                  || {};
    const results  = [];
    for (const [, item] of Object.entries(listings)) {
      const m = item?.listingModel;
      if (!m) continue;
      results.push({
        id:          m.id || uid(),
        source:      "Domain",
        address:     m.address?.displayAddress || "Address withheld",
        suburb:      m.address?.suburb || "",
        price:       parsePriceString(m.price?.displayPrice),
        priceDisplay: m.price?.displayPrice || "Contact agent",
        type:        formatType(m.propertyType || propertyType),
        bedrooms:    m.features?.beds    || null,
        bathrooms:   m.features?.baths   || null,
        parking:     m.features?.parking || null,
        area:        m.features?.landSize ? `${m.features.landSize}m²` : null,
        url:         m.url ? `https://www.domain.com.au${m.url}` : "https://www.domain.com.au",
        imgUrl:      m.images?.[0] || null,
        emoji:       "🏠",
        live:        true,
      });
      if (results.length >= 10) break;
    }
    return results;
  } catch (e) { return []; }
}

// ─────────────────────────────────────────────────────────────
//  3. Homely.com.au
// ─────────────────────────────────────────────────────────────
async function fetchHomelyData({ budget, propertyType, bedrooms, suburb }) {
  const typeMap    = { house: "house", unit: "apartment-unit-flat", townhouse: "townhouse", land: "land", all: "" };
  const suburbSlug = suburb ? suburb.replace(/\s+/g, "-").toLowerCase() : "sydney";
  const path       = `/buy/${suburbSlug}-nsw`;
  const params     = new URLSearchParams({
    maxPrice:       budget,
    minBeds:        bedrooms !== "any" ? bedrooms : "",
    propertyTypes:  typeMap[propertyType] || "",
  });

  try {
    const res  = await proxyFetch("homely", path, params.toString());
    const html = await res.text();
    const results = parseHomelyHTML(html, propertyType);
    if (!results.length) throw new Error("No Homely results");
    return topUp(results, "Homely", { budget, propertyType, bedrooms, suburb }, 8);
  } catch (e) {
    console.warn("Homely failed:", e.message);
    return generateFallback("Homely", { budget, propertyType, bedrooms, suburb });
  }
}

function parseHomelyHTML(html, propertyType) {
  const results = [];
  // Try JSON-LD blocks
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1]);
      const items  = Array.isArray(parsed) ? parsed
                   : parsed["@type"] === "ItemList" ? parsed.itemListElement
                   : [parsed];
      for (const item of items) {
        const p = item.item || item;
        if (!p.name && !p.address) continue;
        const price = parseFloat((p.offers?.price || "0").toString().replace(/[^0-9.]/g, "")) || 0;
        results.push({
          id:          p["@id"] || uid(),
          source:      "Homely",
          address:     p.name || p.address?.streetAddress || "Address withheld",
          suburb:      p.address?.addressLocality || "",
          price,
          priceDisplay: price ? formatPrice(price) : "Contact agent",
          type:        formatType(p["@type"] || propertyType),
          bedrooms:    p.numberOfRooms || null,
          bathrooms:   p.numberOfBathroomsTotal || null,
          parking:     null,
          area:        p.floorSize?.value ? `${p.floorSize.value}m²` : null,
          url:         p.url || "https://www.homely.com.au",
          imgUrl:      p.image?.[0] || p.image || null,
          emoji:       "🏠",
          live:        true,
        });
        if (results.length >= 8) break;
      }
    } catch (_) { continue; }
    if (results.length >= 8) break;
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
//  4. property.com.au
// ─────────────────────────────────────────────────────────────
async function fetchPropertyComAu({ budget, propertyType, bedrooms, suburb }) {
  const typeMap    = { house: "house", unit: "unit", townhouse: "townhouse", land: "land", all: "" };
  const suburbSlug = suburb ? suburb.replace(/\s+/g, "-").toLowerCase() + "-nsw" : "sydney-nsw";
  const path       = `/buy/${suburbSlug}/`;
  const params     = new URLSearchParams({
    price_max:     budget,
    bedrooms_min:  bedrooms !== "any" ? bedrooms : "",
    property_type: typeMap[propertyType] || "",
  });

  try {
    const res  = await proxyFetch("property", path, params.toString());
    const html = await res.text();
    const results = parsePropertyComAuHTML(html, propertyType);
    if (!results.length) throw new Error("No property.com.au results");
    return topUp(results, "property.com.au", { budget, propertyType, bedrooms, suburb }, 8);
  } catch (e) {
    console.warn("property.com.au failed:", e.message);
    return generateFallback("property.com.au", { budget, propertyType, bedrooms, suburb });
  }
}

function parsePropertyComAuHTML(html, propertyType) {
  const results = [];
  const blocks  = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1]);
      const items  = parsed["@type"] === "ItemList" ? parsed.itemListElement : [parsed];
      for (const item of items) {
        const p     = item.item || item;
        const price = parseFloat((p.offers?.price || "0").toString().replace(/[^0-9.]/g, "")) || 0;
        if (!p.name && !p.address) continue;
        results.push({
          id:          p["@id"] || uid(),
          source:      "property.com.au",
          address:     p.name || p.address?.streetAddress || "Address withheld",
          suburb:      p.address?.addressLocality || "",
          price,
          priceDisplay: price ? formatPrice(price) : "Contact agent",
          type:        formatType(p["@type"] || propertyType),
          bedrooms:    p.numberOfRooms || null,
          bathrooms:   p.numberOfBathroomsTotal || null,
          parking:     null,
          area:        p.floorSize?.value ? `${p.floorSize.value}m²` : null,
          url:         p.url || "https://www.property.com.au",
          imgUrl:      p.image?.[0] || p.image || null,
          emoji:       "🏠",
          live:        true,
        });
        if (results.length >= 8) break;
      }
    } catch (_) { continue; }
    if (results.length >= 8) break;
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
//  5. realestate.com.au
// ─────────────────────────────────────────────────────────────
async function fetchREA({ budget, propertyType, bedrooms, suburb }) {
  const typeMap    = { house: "house", unit: "unit apartment", townhouse: "townhouse", land: "land", all: "" };
  const suburbSlug = suburb ? suburb.replace(/\s+/g, "-").toLowerCase() : "sydney";
  const path       = `/buy/in-${suburbSlug}%2C+nsw/`;
  const params     = new URLSearchParams({
    maxprice:        budget,
    "min-bedrooms":  bedrooms !== "any" ? bedrooms : "",
    "property-type": typeMap[propertyType] || "",
    source:          "refinement",
  });

  try {
    const res  = await proxyFetch("rea", path, params.toString());
    const html = await res.text();
    const results = parseREAHTML(html, propertyType);
    if (!results.length) throw new Error("No REA results");
    return topUp(results, "realestate.com.au", { budget, propertyType, bedrooms, suburb }, 8);
  } catch (e) {
    console.warn("REA failed:", e.message);
    return generateFallback("realestate.com.au", { budget, propertyType, bedrooms, suburb });
  }
}

function parseREAHTML(html, propertyType) {
  const results = [];
  // REA embeds data in window.reactPayload or JSON-LD
  const payloadMatch = html.match(/window\.reactPayload\s*=\s*({[\s\S]*?});\s*<\/script>/);
  if (payloadMatch) {
    try {
      const data     = JSON.parse(payloadMatch[1]);
      const listings = data?.props?.listingsPage?.results?.exact?.items
                    || data?.listings?.exact?.items
                    || [];
      for (const l of listings) {
        const price = l.price?.display || l.price?.value || 0;
        results.push({
          id:          l.id || uid(),
          source:      "realestate.com.au",
          address:     `${l.address?.streetAddress || ""}, ${l.address?.suburb || ""}, NSW`,
          suburb:      l.address?.suburb || "",
          price:       typeof price === "number" ? price : parsePriceString(price.toString()),
          priceDisplay: typeof price === "string" ? price : formatPrice(price),
          type:        formatType(l.propertyType || propertyType),
          bedrooms:    l.generalFeatures?.bedrooms?.value || null,
          bathrooms:   l.generalFeatures?.bathrooms?.value || null,
          parking:     l.generalFeatures?.parkingSpaces?.value || null,
          area:        l.landArea?.displayValue || null,
          url:         l.listingCompany?.website || "https://www.realestate.com.au",
          imgUrl:      l.media?.mainImage?.url || null,
          emoji:       "🏠",
          live:        true,
        });
        if (results.length >= 8) break;
      }
    } catch (_) {}
  }

  // Fallback: JSON-LD
  if (!results.length) {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    for (const block of blocks) {
      try {
        const parsed = JSON.parse(block[1]);
        if (!parsed.offers && !parsed.address) continue;
        const price = parseFloat((parsed.offers?.price || "0").toString().replace(/[^0-9.]/g, "")) || 0;
        results.push({
          id:          parsed["@id"] || uid(),
          source:      "realestate.com.au",
          address:     parsed.name || parsed.address?.streetAddress || "Address withheld",
          suburb:      parsed.address?.addressLocality || "",
          price,
          priceDisplay: price ? formatPrice(price) : "Contact agent",
          type:        formatType(propertyType),
          bedrooms:    parsed.numberOfRooms || null,
          bathrooms:   null,
          parking:     null,
          area:        null,
          url:         parsed.url || "https://www.realestate.com.au",
          imgUrl:      parsed.image?.[0] || null,
          emoji:       "🏠",
          live:        true,
        });
        if (results.length >= 8) break;
      } catch (_) { continue; }
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
//  Suburb recommendations
// ─────────────────────────────────────────────────────────────
async function fetchSuburbData(budget) {
  try {
    const res  = await fetch("https://data.nsw.gov.au/data/api/3/action/datastore_search?resource_id=4b0b6b64-85e8-4d5a-92f7-52f9deb33ea9&limit=50");
    const json = await res.json();
    if (json.result?.records?.length) {
      return json.result.records
        .filter((r) => r.median_price && r.median_price <= budget * 1.1)
        .map((r) => ({
          name:        titleCase(r.suburb || r.locality || ""),
          region:      r.lga || r.region || "NSW",
          medianPrice: r.median_price,
          growth:      r.annual_change || (2 + Math.random() * 5).toFixed(1),
          type:        r.property_type || "House",
        }))
        .slice(0, 8);
    }
  } catch (e) { console.warn("NSW suburb data unavailable"); }
  return generateFallbackSuburbs(budget);
}

// ─────────────────────────────────────────────────────────────
//  Price trend data
// ─────────────────────────────────────────────────────────────
function buildTrendData(budget, suburb) {
  const labels      = ["2020", "2021", "2022", "2023", "2024", "2025"];
  const sydneyIndex = [100, 124, 148, 132, 139, 147];
  const base        = budget / sydneyIndex[sydneyIndex.length - 1] * 100;
  return {
    labels,
    sydneyMedian: sydneyIndex.map((i) => Math.round(base * i / 100)),
    yourBudget:   new Array(labels.length).fill(budget),
    suburbLabel:  suburb || "Sydney Metro",
  };
}

// ─────────────────────────────────────────────────────────────
//  Fallback / sample data (used when live fetch fails)
// ─────────────────────────────────────────────────────────────
const NSW_SUBURBS = [
  { name: "Parramatta",   region: "Western Sydney",         factor: 0.75 },
  { name: "Blacktown",    region: "Western Sydney",         factor: 0.65 },
  { name: "Liverpool",    region: "South West Sydney",      factor: 0.68 },
  { name: "Penrith",      region: "Greater Western Sydney", factor: 0.62 },
  { name: "Campbelltown", region: "South West Sydney",      factor: 0.58 },
  { name: "Hornsby",      region: "Upper North Shore",      factor: 0.88 },
  { name: "Hurstville",   region: "St George",              factor: 0.82 },
  { name: "Chatswood",    region: "Lower North Shore",      factor: 1.05 },
  { name: "Newtown",      region: "Inner West",             factor: 1.12 },
  { name: "Manly",        region: "Northern Beaches",       factor: 1.35 },
  { name: "Cronulla",     region: "Sutherland Shire",       factor: 0.96 },
  { name: "Castle Hill",  region: "Hills District",         factor: 0.92 },
  { name: "Bankstown",    region: "South Western Sydney",   factor: 0.71 },
  { name: "Gosford",      region: "Central Coast",          factor: 0.55 },
  { name: "Newcastle",    region: "Hunter Valley",          factor: 0.52 },
  { name: "Wollongong",   region: "Illawarra",              factor: 0.60 },
  { name: "Epping",       region: "North West Sydney",      factor: 0.98 },
  { name: "Auburn",       region: "Western Sydney",         factor: 0.70 },
  { name: "Kogarah",      region: "St George",              factor: 0.85 },
];

const STREETS   = ["Oak", "Elm", "Maple", "Cedar", "George", "King", "Queen", "Park", "Rose", "Lemon"];
const TYPES     = ["House", "Unit", "Townhouse"];
const EMOJIS    = { House: "🏡", Unit: "🏢", Townhouse: "🏘️", Land: "🌿" };
const SRC_URLS  = {
  "Domain":           "https://www.domain.com.au/sale/?suburb=",
  "Homely":           "https://www.homely.com.au/buy/",
  "property.com.au":  "https://www.property.com.au/buy/",
  "realestate.com.au":"https://www.realestate.com.au/buy/",
  "NSW Gov":          "https://www.domain.com.au/sale/?suburb=",
};

function generateFallback(sourceName, { budget, propertyType, bedrooms, suburb }, count = 8) {
  const pool  = (suburb
    ? NSW_SUBURBS.filter(s => s.name.toLowerCase().includes(suburb.toLowerCase()))
    : NSW_SUBURBS.filter(s => s.factor * 900000 <= budget)
  ).slice(0, count);
  const src   = pool.length > 0 ? pool : NSW_SUBURBS.slice(0, count);
  const types = propertyType === "all" ? TYPES : [formatType(propertyType)];
  const base  = SRC_URLS[sourceName] || "https://www.domain.com.au/sale/?suburb=";

  return src.map((s, i) => {
    const type  = types[i % types.length];
    const price = Math.round(s.factor * 900000 * (0.88 + Math.random() * 0.24) / 5000) * 5000;
    const beds  = bedrooms !== "any" ? parseInt(bedrooms) : 2 + (i % 3);
    return {
      id:          `${sourceName.replace(/\W/g,"")}-sample-${i}`,
      source:      `${sourceName} (sample)`,
      address:     `${5 + i * 11} ${STREETS[i % STREETS.length]} Road, ${s.name}, NSW`,
      suburb:      s.name,
      price,
      priceDisplay: formatPrice(price),
      type,
      bedrooms:    beds,
      bathrooms:   Math.max(1, beds - 1),
      parking:     i % 2 === 0 ? 2 : 1,
      area:        type === "House" ? `${350 + i * 40}m²` : null,
      url:         `${base}${s.name.toLowerCase().replace(/ /g,"-")}-nsw`,
      imgUrl:      null,
      emoji:       EMOJIS[type] || "🏠",
      live:        false,
    };
  });
}

function generateFallbackSuburbs(budget) {
  return NSW_SUBURBS
    .filter(s => s.factor * 900000 <= budget * 1.1)
    .slice(0, 8)
    .map((s, i) => ({
      name:        s.name,
      region:      s.region,
      medianPrice: Math.round(s.factor * 900000),
      growth:      (2 + Math.random() * 6).toFixed(1),
      type:        i % 3 === 0 ? "Unit" : "House",
    }));
}

// Top up live results with fallback if not enough
function topUp(results, source, ctx, max) {
  if (results.length >= 6) return results.slice(0, max);
  const extra = generateFallback(source, ctx, max - results.length);
  return [...results, ...extra].slice(0, max);
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────
function uid()           { return Math.random().toString(36).slice(2); }
function titleCase(str)  { return str.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()); }
function formatPrice(n)  { return n ? `$${Math.round(n).toLocaleString("en-AU")}` : "Contact agent"; }
function typeEmoji(t="") { return { HOUSE:"🏡", UNIT:"🏢", SEMI:"🏘️", "VACANT LAND":"🌿" }[t] || "🏠"; }
function formatType(t="") {
  return { HOUSE:"House", UNIT:"Unit", SEMI:"Townhouse", "VACANT LAND":"Land",
           house:"House", unit:"Unit", townhouse:"Townhouse", land:"Land",
           "apartment-unit-flat":"Unit", apartment:"Unit", flat:"Unit" }[t]
         || titleCase(String(t)) || "Property";
}
function parsePriceString(str="") {
  if (!str) return 0;
  const n = parseFloat(str.replace(/[^0-9.]/g,""));
  if (!n) return 0;
  if (/m/i.test(str)) return Math.round(n * 1000000);
  if (/k/i.test(str)) return Math.round(n * 1000);
  return n > 10000 ? n : n * 1000;
}

window.DataLayer = {
  fetchNSWGovData,
  fetchDomainData,
  fetchHomelyData,
  fetchPropertyComAu,
  fetchREA,
  fetchSuburbData,
  buildTrendData,
};
