/**
 * Cloudflare Worker — NSW Property Agent Proxy
 *
 * Proxies requests to:
 *  - Domain.com.au
 *  - Homely.com.au
 *  - property.com.au
 *  - NSW Government API
 *  - REA Group (realestate.com.au)
 *
 * Deploy free at: dash.cloudflare.com/workers
 * Free tier: 100,000 requests/day — more than enough
 */

const ALLOWED_ORIGINS = ["*"]; // Allow your GitHub Pages site

const PROXY_TARGETS = {
  domain:      "https://www.domain.com.au",
  homely:      "https://www.homely.com.au",
  property:    "https://www.property.com.au",
  nswgov:      "https://maps.six.nsw.gov.au",
  rea:         "https://www.realestate.com.au",
};

// Headers to send to target sites (mimic a real browser)
const BROWSER_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control":   "no-cache",
  "Pragma":          "no-cache",
};

// CORS headers returned to the browser
const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
  "Access-Control-Max-Age":       "86400",
};

export default {
  async fetch(request, env, ctx) {
    // Handle preflight OPTIONS request
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "ok",
        message: "NSW Property Agent Proxy is running",
        endpoints: Object.keys(PROXY_TARGETS).map(k => `/proxy/${k}`),
      }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Route: /proxy/{target}/{path}
    // e.g. /proxy/domain/sale/sydney-nsw/?price=0-750000
    const match = url.pathname.match(/^\/proxy\/([a-z]+)(\/.*)?$/);
    if (!match) {
      return new Response(JSON.stringify({ error: "Invalid proxy route. Use /proxy/{target}/path" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const targetKey  = match[1];
    const targetPath = match[2] || "/";
    const baseUrl    = PROXY_TARGETS[targetKey];

    if (!baseUrl) {
      return new Response(JSON.stringify({
        error: `Unknown target: ${targetKey}. Valid targets: ${Object.keys(PROXY_TARGETS).join(", ")}`,
      }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Build target URL — preserve query string
    const targetUrl = `${baseUrl}${targetPath}${url.search}`;

    try {
      const response = await fetch(targetUrl, {
        method:  request.method,
        headers: BROWSER_HEADERS,
        // Forward body for POST requests
        body: request.method !== "GET" && request.method !== "HEAD"
          ? await request.text()
          : undefined,
        // Follow redirects
        redirect: "follow",
      });

      // Get response body
      const body = await response.arrayBuffer();

      // Build response headers — keep content type, add CORS
      const responseHeaders = new Headers(CORS_HEADERS);
      const contentType = response.headers.get("content-type");
      if (contentType) responseHeaders.set("Content-Type", contentType);
      responseHeaders.set("X-Proxied-From", targetUrl);
      responseHeaders.set("X-Proxy-Status", response.status.toString());

      return new Response(body, {
        status:  response.status,
        headers: responseHeaders,
      });

    } catch (error) {
      return new Response(JSON.stringify({
        error:   "Proxy fetch failed",
        message: error.message,
        target:  targetUrl,
      }), {
        status:  502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  },
};
