const storage = {
  get(key) {
    return window.localStorage.getItem(key) || "";
  },
  set(key, value) {
    window.localStorage.setItem(key, value || "");
  },
  remove(key) {
    window.localStorage.removeItem(key);
  }
};

function $(id) {
  return document.getElementById(id);
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function formatLatency(value) {
  return `${Math.round(Number(value || 0))} ms`;
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString();
}

function inferProvider(model) {
  const label = String(model || "").toLowerCase();
  if (label.includes("gemini")) return "Gemini";
  if (label.includes("llama") || label.includes("gpt-oss")) return "Groq";
  return "Unknown";
}

function authHeader(key) {
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function setError(id, message) {
  const node = $(id);
  if (!node) return;
  if (!message) {
    node.textContent = "";
    node.classList.remove("visible");
    return;
  }
  node.textContent = message;
  node.classList.add("visible");
}

function normalizeErrorMessage(error) {
  const text = String(error?.message || error || "Request failed");
  if (/unauthorized/i.test(text)) {
    return "Unauthorized. The tenant key is missing, expired, or invalid.";
  }
  if (/quota exceeded/i.test(text)) {
    return `${text}. This demo uses strict shared limits to keep the public deployment safe.`;
  }
  if (/rate_limited|too many requests/i.test(text)) {
    return "Rate limit reached. Wait a moment and try again.";
  }
  if (/upstream|model unavailable/i.test(text)) {
    return "The upstream model is unavailable right now. Try again in a few seconds.";
  }
  return text;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (!response.ok) {
    throw new Error(body.error || body.code || `Request failed with ${response.status}`);
  }

  return body;
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

function setBadge(id, text, tone) {
  const node = $(id);
  if (!node) return;
  node.textContent = text;
  node.className = `badge ${tone || ""}`.trim();
}

function rememberAskHistory(entry) {
  const key = "router_request_history";
  const history = JSON.parse(storage.get(key) || "[]");
  history.unshift(entry);
  storage.set(key, JSON.stringify(history.slice(0, 6)));
}

function loadAskHistory() {
  try {
    return JSON.parse(storage.get("router_request_history") || "[]");
  } catch {
    return [];
  }
}

function renderHistory() {
  const node = $("request-history");
  if (!node) return;
  const items = loadAskHistory();
  if (!items.length) {
    node.innerHTML = '<div class="footer-note">No requests yet. Send one through the router to populate this panel.</div>';
    return;
  }

  node.innerHTML = items.map(item => `
    <div class="history-item fade-in">
      <strong>${item.prompt}</strong>
      <span class="status-line mono">${item.route} · ${item.model} · ${formatLatency(item.latency)}</span>
    </div>
  `).join("");
}

function renderTrace(data) {
  const confidence = Number(data.intentConfidence || 0);
  const trace = [
    { label: "Authentication", detail: "Tenant key accepted" },
    { label: "Rate Limit", detail: "Request accepted" },
    { label: "Intent Detection", detail: `${data.intent} (${(confidence * 100).toFixed(0)}% via ${data.intentSource})` },
    { label: "Route Selection", detail: data.route },
    { label: "Model Selection", detail: `${data.model} via ${inferProvider(data.model)}` },
    { label: "Response Cache", detail: data.cached ? "Cache hit" : "Cache miss" },
    { label: "Usage Tracking", detail: `${data.usage?.totalTokens || 0} total tokens · ${formatCurrency(data.cost)}` }
  ];

  const node = $("trace-list");
  if (!node) return;
  node.innerHTML = trace.map((step, index) => `
    <div class="trace-step fade-in">
      <div class="trace-index mono">${index + 1}</div>
      <div>
        <strong>${step.label}</strong>
        <small>${step.detail}</small>
      </div>
    </div>
  `).join("");
}

function setResponseState(text, isEmpty = false) {
  const node = $("response-output");
  if (!node) return;
  node.textContent = text;
  node.classList.toggle("empty-state", isEmpty);
}

function applyPrompt(prompt) {
  const input = $("prompt-input");
  if (!input) return;
  input.value = prompt;
  storage.set("last_prompt", prompt);
}

function renderSamplePrompts(prompts) {
  const node = $("sample-prompts");
  if (!node) return;
  node.innerHTML = prompts.map(prompt => `
    <button class="chip" type="button" data-prompt="${prompt.replace(/"/g, '&quot;')}">${prompt}</button>
  `).join("");

  node.querySelectorAll(".chip").forEach(button => {
    button.addEventListener("click", () => applyPrompt(button.dataset.prompt || ""));
  });
}

async function initAskPage() {
  const tenantInput = $("tenant-api-key");
  const promptInput = $("prompt-input");
  const submit = $("send-request");
  const clear = $("clear-request");
  const copyKey = $("copy-demo-key");
  const hint = $("request-hint");

  let demoConfig = {
    demoMode: true,
    demoTenantApiKey: "sk_demo_public",
    samplePrompts: []
  };

  try {
    demoConfig = await fetchJson("/demo/config");
  } catch {
    // Keep page usable with local defaults if demo config is unavailable.
  }

  tenantInput.value = storage.get("tenant_api_key") || demoConfig.demoTenantApiKey;
  promptInput.value = storage.get("last_prompt") || "Explain how distributed systems handle failure and recovery.";
  renderSamplePrompts(demoConfig.samplePrompts || []);
  renderHistory();

  tenantInput.addEventListener("input", () => storage.set("tenant_api_key", tenantInput.value.trim()));
  promptInput.addEventListener("input", () => storage.set("last_prompt", promptInput.value));

  copyKey.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(tenantInput.value.trim());
      copyKey.textContent = "Copied";
      setTimeout(() => {
        copyKey.textContent = "Copy Key";
      }, 1200);
    } catch {
      setError("ask-error", "Could not copy the key. You can still use it directly from the field.");
    }
  });

  submit.addEventListener("click", async () => {
    setError("ask-error", "");
    submit.disabled = true;
    submit.textContent = "Routing request...";
    hint.textContent = "Detecting intent and selecting the best route...";
    setResponseState("Routing request...", true);

    try {
      const tenantKey = tenantInput.value.trim();
      const message = promptInput.value.trim();
      const data = await fetchJson("/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader(tenantKey)
        },
        body: JSON.stringify({ message })
      });

      setResponseState(data.response || "No response");
      setText("intent-value", data.intent || "unknown");
      setText("route-value", data.route || "unknown");
      setText("model-value", data.model || "unknown");
      setText("provider-value", inferProvider(data.model));
      setText("latency-value", formatLatency(data.latency));
      setText("cost-value", formatCurrency(data.cost));
      setText("usage-total-value", `${formatInteger(data.usage?.totalTokens || 0)} total`);
      setText(
        "usage-breakdown-value",
        `${formatInteger(data.usage?.promptTokens || 0)} / ${formatInteger(data.usage?.completionTokens || 0)}`
      );
      setBadge("cache-badge", data.cached ? "Cache Hit" : "Cache Miss", data.cached ? "good" : "warn");
      setBadge("failover-badge", data.failover ? "Failover" : "Primary", data.failover ? "warn" : "good");
      renderTrace(data);
      rememberAskHistory({
        prompt: message.length > 72 ? `${message.slice(0, 72)}...` : message,
        route: data.route,
        model: data.model,
        latency: data.latency
      });
      renderHistory();
      hint.textContent = "Repeat the same prompt to see a cache hit and much faster latency.";
    } catch (error) {
      setResponseState("Send a prompt to see routing behavior.", true);
      setError("ask-error", normalizeErrorMessage(error));
      hint.textContent = "The router is still healthy. Adjust the key or prompt and try again.";
    } finally {
      submit.disabled = false;
      submit.textContent = "Send Through Router";
    }
  });

  clear.addEventListener("click", () => {
    promptInput.value = "";
    storage.set("last_prompt", "");
    setResponseState("Send a prompt to see routing behavior.", true);
    hint.textContent = "Try one of the sample prompts to trigger different routes.";
  });
}

function setProgress(id, current, max) {
  const node = $(id);
  if (!node) return;
  const safeMax = Math.max(Number(max || 0), 1);
  const pct = Math.min((Number(current || 0) / safeMax) * 100, 100);
  node.style.width = `${pct}%`;
}

function formatQuota(current, max, formatter = formatInteger) {
  return `${formatter(current)} / ${formatter(max)}`;
}

function formatResetTime(lastReset) {
  const resetAt = Number(lastReset || 0) + 86_400_000;
  const remaining = Math.max(resetAt - Date.now(), 0);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

function clearPersistedAdminKey() {
  storage.remove("admin_api_key");
}

async function initTenantPage() {
  const adminInput = $("tenant-admin-key");
  const tenantInput = $("tenant-lookup-key");
  const submit = $("load-tenant");

  clearPersistedAdminKey();
  adminInput.value = "";
  tenantInput.value = storage.get("tenant_api_key");

  tenantInput.addEventListener("input", () => storage.set("tenant_api_key", tenantInput.value.trim()));

  submit.addEventListener("click", async () => {
    setError("tenant-error", "");
    submit.disabled = true;
    submit.textContent = "Loading...";

    try {
      const adminKey = adminInput.value.trim();
      const tenantKey = tenantInput.value.trim();
      const data = await fetchJson(`/admin/tenants/${encodeURIComponent(tenantKey)}`, {
        headers: authHeader(adminKey)
      });

      setText("tenant-name", data.name || "Unknown tenant");
      setText("tenant-id", data.tenantId || "n/a");
      setText("tenant-reset", formatResetTime(data.lastReset));
      setText(
        "tenant-requests",
        formatQuota(data.requestsToday || 0, data.maxRequestsPerDay || 0)
      );
      setText(
        "tenant-tokens",
        formatQuota(data.totalTokens || 0, data.maxTokensPerDay || 0)
      );
      setText(
        "tenant-cost",
        `${formatCurrency(data.totalCost)} / ${formatCurrency(data.maxCostPerDay)}`
      );
      setProgress("tenant-requests-bar", data.requestsToday, data.maxRequestsPerDay);
      setProgress("tenant-tokens-bar", data.totalTokens, data.maxTokensPerDay);
      setProgress("tenant-cost-bar", data.totalCost, data.maxCostPerDay);
      $("tenant-summary").classList.add("fade-in");
    } catch (error) {
      setError("tenant-error", normalizeErrorMessage(error));
    } finally {
      adminInput.value = "";
      submit.disabled = false;
      submit.textContent = "Load Tenant";
    }
  });
}

function healthTone(entry) {
  if (!entry) return "warn";
  if (entry.failures > 0) return "warn";
  if (entry.avgLatency > 1200) return "warn";
  return "good";
}

async function initAdminPage() {
  const adminInput = $("admin-key");
  const submit = $("load-admin");
  clearPersistedAdminKey();
  adminInput.value = "";

  submit.addEventListener("click", async () => {
    setError("admin-error", "");
    submit.disabled = true;
    submit.textContent = "Refreshing...";

    try {
      const adminKey = adminInput.value.trim();
      const data = await fetchJson("/admin/metrics", {
        headers: authHeader(adminKey)
      });

      setText("requests-total", String(data.requests_total || 0));
      setText("cache-hit-rate", formatPercent(data.cache_hit_rate));
      setText("failover-rate", formatPercent(data.failover_rate));
      setText("avg-latency", formatLatency(data.avg_latency_ms));
      setText("llama-latency", formatLatency(data.provider_latency?.llama));
      setText("gpt-latency", formatLatency(data.provider_latency?.gpt_oss));
      setText("gemini-latency", formatLatency(data.provider_latency?.gemini));

      const health = data.model_health || {};
      const rows = Object.entries(health).map(([model, entry]) => `
        <tr>
          <td class="mono">${model}</td>
          <td>${inferProvider(model)}</td>
          <td class="mono">${formatLatency(entry.avgLatency)}</td>
          <td>
            <span class="badge ${healthTone(entry)}">${entry.failures > 0 ? "Watch" : "Good"}</span>
          </td>
        </tr>
      `).join("");
      $("health-table-body").innerHTML = rows || '<tr><td colspan="4">No health data yet.</td></tr>';
    } catch (error) {
      setError("admin-error", normalizeErrorMessage(error));
    } finally {
      adminInput.value = "";
      submit.disabled = false;
      submit.textContent = "Refresh Metrics";
    }
  });
}

function setActiveNav() {
  const page = document.body.dataset.page;
  document.querySelectorAll(".nav a").forEach(link => {
    link.dataset.active = link.dataset.page === page ? "true" : "false";
  });
}

window.addEventListener("DOMContentLoaded", () => {
  setActiveNav();
  const page = document.body.dataset.page;
  if (page === "ask") initAskPage();
  if (page === "tenant") initTenantPage();
  if (page === "admin") initAdminPage();
});
