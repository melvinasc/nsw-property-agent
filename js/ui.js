/**
 * ui.js — Rendering layer
 * Handles properties grid, suburb cards, Chart.js trends, AI summary, tabs
 */

let trendsChartInstance = null;

const UI = {
  // ── Properties ─────────────────────────────────────────
  renderProperties(properties) {
    const grid = document.getElementById("properties-grid");
    if (!properties.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:#6b7280">No properties found for this budget. Try increasing your budget or broadening your search.</div>`;
      return;
    }

    grid.innerHTML = properties.map((p) => {
      const price = p.priceDisplay || formatPrice(p.price);
      const features = [
        p.bedrooms ? `${p.bedrooms} 🛏` : null,
        p.bathrooms ? `${p.bathrooms} 🚿` : null,
        p.parking   ? `${p.parking} 🚗` : null,
        p.area      ? p.area : null,
      ].filter(Boolean).join("  ·  ");

      const sourceBadge = p.source.includes("sample")
        ? `<span class="prop-tag" style="background:#fef9c3;color:#854d0e">Sample data</span>`
        : `<span class="prop-tag match">${p.source}</span>`;

      return `
        <div class="property-card">
          <div class="prop-img">${p.imgUrl
            ? `<img src="${p.imgUrl}" alt="${p.address}" style="width:100%;height:100%;object-fit:cover" loading="lazy">`
            : p.emoji || "🏠"}
          </div>
          <div class="prop-body">
            <div class="prop-price">${price}</div>
            <div class="prop-address">${p.address}</div>
            ${features ? `<div class="prop-source">${features}</div>` : ""}
            <div class="prop-tags" style="margin-top:8px">
              <span class="prop-tag">${p.type}</span>
              ${sourceBadge}
            </div>
            ${p.saleDate ? `<div class="prop-source" style="margin-top:6px">Sold: ${p.saleDate}</div>` : ""}
            <a href="${p.url}" target="_blank" rel="noopener" class="prop-link">View listing →</a>
          </div>
        </div>`;
    }).join("");
  },

  // ── Suburbs ────────────────────────────────────────────
  renderSuburbs(suburbs, budget) {
    const list = document.getElementById("suburbs-list");

    const tags = {
      low: ["Under budget", "First home buyer", "Good value"],
      mid: ["Solid investment", "Growing area", "Lifestyle suburb"],
      high: ["Top-end buy", "Premium location", "Competitive market"],
    };

    list.innerHTML = suburbs.map((s, i) => {
      const ratio = s.medianPrice / budget;
      const tier = ratio < 0.75 ? "low" : ratio < 0.95 ? "mid" : "high";
      const affordability = ratio < 0.8 ? "Well within budget" : ratio < 0.95 ? "Within budget" : "At budget limit";
      const growth = s.growth ? `+${s.growth}%` : "N/A";
      const tagSet = tags[tier];
      const rank = i + 1;

      return `
        <div class="suburb-card">
          <div>
            <div class="suburb-name">#${rank} ${s.name}</div>
            <div class="suburb-meta">${s.region} · Median $${(s.medianPrice / 1000).toFixed(0)}k · ${s.type} · ${affordability}</div>
          </div>
          <div class="suburb-score">
            ${growth}
            <span>Annual growth</span>
          </div>
          <div class="suburb-tags">
            ${tagSet.map((t) => `<span class="suburb-tag">${t}</span>`).join("")}
          </div>
        </div>`;
    }).join("");
  },

  // ── Price Trends Chart ─────────────────────────────────
  renderTrends(trendData) {
    const canvas = document.getElementById("trendsChart");
    if (trendsChartInstance) trendsChartInstance.destroy();

    trendsChartInstance = new Chart(canvas, {
      type: "line",
      data: {
        labels: trendData.labels,
        datasets: [
          {
            label: `${trendData.suburbLabel || "Sydney Metro"} Median`,
            data: trendData.sydneyMedian,
            borderColor: "#2563eb",
            backgroundColor: "rgba(37,99,235,0.08)",
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointBackgroundColor: "#2563eb",
          },
          {
            label: "Your Budget",
            data: trendData.yourBudget,
            borderColor: "#d97706",
            borderDash: [8, 4],
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: "top", labels: { font: { family: "Inter", size: 13 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => ` $${(ctx.raw / 1000).toFixed(0)}k`,
            },
          },
          title: {
            display: true,
            text: "NSW Median Property Price vs Your Budget (2020–2025)",
            font: { family: "DM Serif Display", size: 15 },
            color: "#0f1117",
            padding: { bottom: 16 },
          },
        },
        scales: {
          y: {
            ticks: {
              callback: (v) => `$${(v / 1000).toFixed(0)}k`,
              font: { family: "Inter", size: 11 },
            },
            grid: { color: "#e2e8f0" },
          },
          x: {
            ticks: { font: { family: "Inter", size: 12 } },
            grid: { display: false },
          },
        },
      },
    });
  },

  // ── AI Summary ─────────────────────────────────────────
  renderSummary(text) {
    document.getElementById("summary-text").textContent = text;
  },
};

// ── Tab switching ───────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.add("hidden"));
      tab.classList.add("active");
      const id = "tab-" + tab.dataset.tab;
      document.getElementById(id).classList.remove("hidden");
    });
  });

  // Budget formatting hint
  const budgetInput = document.getElementById("budget");
  budgetInput.addEventListener("blur", () => {
    if (budgetInput.value) {
      const n = parseInt(budgetInput.value);
      if (!isNaN(n)) budgetInput.title = `$${n.toLocaleString("en-AU")}`;
    }
  });
});

window.UI = UI;
