const TOKEN = window.PANEL_TOKEN;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let HEALTH = null;
let currentRunId = null;
let currentES = null;
let detailId = null;

/* ---------- api ---------- */
async function api(path, { method = "GET", body, form } = {}) {
  const headers = {};
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (method !== "GET") headers["x-panel-token"] = TOKEN;
  const res = await fetch(path, { method, headers, body: payload });
  const json = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
  if (!json.success) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data;
}

/* ---------- toasts ---------- */
function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "error" ? 6500 : 3500);
}
const oops = (e) => toast(e.message || String(e), "error");

/* ---------- markdown (tiny) ---------- */
function mdToHtml(md) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const inline = (t) =>
    esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let html = "", i = 0, ul = false, ol = false;
  const close = () => { if (ul) { html += "</ul>"; ul = false; } if (ol) { html += "</ol>"; ol = false; } };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) { close(); i++; let code = ""; while (i < lines.length && !/^```/.test(lines[i])) code += esc(lines[i++]) + "\n"; i++; html += `<pre><code>${code}</code></pre>`; continue; }
    if (/^\s*$/.test(line)) { close(); i++; continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { close(); html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) { if (!ul) { close(); html += "<ul>"; ul = true; } html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`; i++; continue; }
    if (/^\s*\d+\.\s+/.test(line)) { if (!ol) { close(); html += "<ol>"; ol = true; } html += `<li>${inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`; i++; continue; }
    if (/^\s*>\s?/.test(line)) { close(); html += `<blockquote>${inline(line.replace(/^\s*>\s?/, ""))}</blockquote>`; i++; continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { close(); html += "<hr/>"; i++; continue; }
    close(); html += `<p>${inline(line)}</p>`; i++;
  }
  close();
  return html;
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- health ---------- */
async function refreshHealth() {
  const badge = $("#health");
  try {
    HEALTH = await api("/api/health");
    badge.className = "health ok";
    $("#health-text").textContent = `已连接 · ${HEALTH.skills} skills`;
    badge.title = `AI keys: ${HEALTH.aiKeys.join(", ") || "无"} · 去重库: ${HEALTH.dedupDb ? "✓" : "✗"}`;
  } catch {
    badge.className = "health bad";
    $("#health-text").textContent = "未连接";
  }
}

/* ---------- skill list ---------- */
function statusBadge(s) {
  if (s.running) return `<span class="badge running"><span class="dot"></span>运行中</span>`;
  const k = s.status?.kind ?? s.status;
  if (k === "ready") return `<span class="badge ready">ready</span>`;
  if (k === "disabled") return `<span class="badge disabled">已停用</span>`;
  if (k === "missing-env") return `<span class="badge missing-env">缺 env</span>`;
  return "";
}

async function loadSkills() {
  const grid = $("#skill-list");
  try {
    const skills = await api("/api/skills");
    if (!skills.length) {
      grid.innerHTML = `<div class="empty muted">还没有 skill。点「导入」加入一个本地 skill 文件夹或 zip。</div>`;
      return;
    }
    grid.innerHTML = skills.map(cardHtml).join("");
    skills.forEach(wireCard);
  } catch (e) {
    grid.innerHTML = `<div class="empty muted">加载失败：${escapeHtml(e.message)}</div>`;
  }
}

function cardHtml(s) {
  return `<div class="skill-card" data-id="${s.id}">
    <div class="sc-top">
      <div>
        <div class="sc-title">${escapeHtml(s.title)}</div>
        <code class="sc-id">${s.id}</code>
      </div>
      <label class="switch" data-stop><input type="checkbox" data-toggle ${s.enabled ? "checked" : ""}/><span class="slider"></span></label>
    </div>
    <div class="sc-desc">${escapeHtml(s.description || "—")}</div>
    <div class="sc-meta">${statusBadge(s)}<span class="sc-spacer"></span><span>最近日报 ${s.lastReport ?? "—"}</span></div>
    <div class="sc-actions" data-stop>
      <button data-run-dry class="ghost">Dry-run</button>
      <button data-run>运行</button>
      <button data-reports class="ghost" ${s.lastReport ? "" : "disabled"}>日报</button>
      <span class="sc-spacer"></span>
      <button data-detail class="ghost">详情</button>
    </div>
  </div>`;
}

function wireCard(s) {
  const card = $(`.skill-card[data-id="${s.id}"]`);
  card.addEventListener("click", (e) => { if (!e.target.closest("[data-stop]")) openDetail(s.id); });
  $("[data-toggle]", card).addEventListener("change", async (e) => {
    try { await api(`/api/skills/${s.id}`, { method: "PATCH", body: { enabled: e.target.checked } }); toast(`${s.id} 已${e.target.checked ? "启用" : "停用"}`, "success"); loadSkills(); }
    catch (err) { e.target.checked = !e.target.checked; oops(err); }
  });
  $("[data-run-dry]", card).addEventListener("click", () => runSkill(s.id, true));
  $("[data-run]", card).addEventListener("click", () => runSkill(s.id, false));
  $("[data-reports]", card).addEventListener("click", () => openReports(s.id, s.title));
  $("[data-detail]", card).addEventListener("click", () => openDetail(s.id));
}

/* ---------- detail drawer ---------- */
async function openDetail(id) {
  detailId = id;
  $("#detail").hidden = false;
  $("#scrim").hidden = false;
  $("#d-title").textContent = id;
  $("#d-id").textContent = id;
  switchTab("overview");
  try {
    const d = await api(`/api/skills/${id}`);
    $("#d-title").textContent = d.manifest.title;
    renderOverview(d);
    renderTree(d.tree);
    renderRuns(d.runs);
    window._detail = d;
  } catch (e) { oops(e); }
}
function closeDetail() { $("#detail").hidden = true; $("#scrim").hidden = true; detailId = null; }
$("#d-close").addEventListener("click", closeDetail);
$("#scrim").addEventListener("click", closeDetail);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#log-drawer").hidden) { if (currentES) currentES.close(); currentES = null; $("#log-drawer").hidden = true; return; }
  if (!$("#detail").hidden) closeDetail();
});
$$(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));
function switchTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".pane").forEach((p) => (p.hidden = p.dataset.pane !== name));
}

function renderOverview(d) {
  const m = d.manifest;
  const env = d.env.length
    ? d.env.map((e) => `<div class="env-row"><span class="${e.present ? "ok" : "no"}">${e.present ? "✓" : "✗"}</span> <code>${e.name}</code> ${e.present ? "" : '<span class="muted">未设置</span>'}</div>`).join("")
    : `<div class="muted" style="font-size:13px">无需要的环境变量</div>`;
  $('[data-pane="overview"]').innerHTML = `
    <dl class="kv">
      <dt>状态</dt><dd>${statusBadge({ ...d, status: d.status })}</dd>
      <dt>描述</dt><dd>${escapeHtml(m.description || "—")}</dd>
      <dt>AI</dt><dd>${m.ai.mode} · ${m.ai.provider}${m.ai.model ? " · " + escapeHtml(m.ai.model) : ""}</dd>
      <dt>计划</dt><dd>${m.schedule.cron ? `<code>${escapeHtml(m.schedule.cron)}</code> · ` : ""}${m.schedule.timezone}</dd>
      <dt>日报</dt><dd>${d.reports.length ? `${d.reports.length} 篇，最近 ${d.reports[0]}` : "—"}</dd>
    </dl>
    <div class="section-h">环境变量</div>${env}
    <div class="section-h">操作</div>
    <div class="btn-row">
      <button id="d-run">运行</button>
      <button id="d-dry" class="ghost">Dry-run</button>
      <button id="d-report" class="ghost" ${d.reports.length ? "" : "disabled"}>看日报</button>
      <button id="d-open" class="ghost">在编辑器打开</button>
      <button id="d-del" class="danger">删除</button>
    </div>`;
  $("#d-run").onclick = () => runSkill(d.manifest.id, false);
  $("#d-dry").onclick = () => runSkill(d.manifest.id, true);
  $("#d-report").onclick = () => openReports(d.manifest.id, d.manifest.title);
  $("#d-open").onclick = async () => { try { const r = await api(`/api/skills/${d.manifest.id}/open`, { method: "POST" }); toast(`已用 ${r.editor} 打开`, "success"); } catch (e) { oops(e); } };
  $("#d-del").onclick = () => deleteSkill(d.manifest.id);
}

function renderTree(tree) {
  const ul = $("#d-tree");
  ul.innerHTML = "";
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      const li = document.createElement("li");
      li.className = (n.type === "dir" ? "dir" : "file") + (depth ? " indent" : "");
      li.style.paddingLeft = `${6 + depth * 12}px`;
      li.textContent = (n.type === "dir" ? "📁 " : "📄 ") + n.name;
      if (n.type === "file") li.onclick = () => openFile(n.path, li);
      ul.appendChild(li);
      if (n.children) walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);
}

async function openFile(rel, li) {
  $$(".tree li").forEach((x) => x.classList.remove("active"));
  li?.classList.add("active");
  try {
    const { content } = await api(`/api/skills/${detailId}/file?path=${encodeURIComponent(rel)}`);
    const area = $("#ed-area");
    area.value = content;
    area.dataset.path = rel;
    $("#ed-path").textContent = rel;
    $("#ed-save").disabled = false;
  } catch (e) { oops(e); }
}
$("#ed-save").addEventListener("click", async () => {
  const path = $("#ed-area").dataset.path;
  if (!path) return;
  try { await api(`/api/skills/${detailId}/file`, { method: "PUT", body: { path, content: $("#ed-area").value } }); toast(`已保存 ${path}`, "success"); }
  catch (e) { oops(e); }
});

function renderRuns(runs) {
  const pane = $('[data-pane="runs"]');
  if (!runs.length) { pane.innerHTML = `<div class="muted" style="font-size:13px">还没有运行记录。</div>`; return; }
  pane.innerHTML = runs
    .map((r) => {
      const dur = Math.max(0, Math.round((r.finishedAt - r.startedAt) / 1000));
      const when = new Date(r.startedAt).toLocaleString();
      const ec = r.exitCode === 0 ? `<span class="ec zero">退出 0</span>` : `<span class="ec nonzero">退出 ${r.exitCode ?? "?"}</span>`;
      return `<div class="run-item" data-run="${r.id}"><span>${when}</span><span class="muted">${r.dryRun ? "dry-run" : "正式"} · ${dur}s</span><span class="sc-spacer"></span>${ec}</div>`;
    })
    .join("");
  $$(".run-item", pane).forEach((el) => el.addEventListener("click", () => viewPastRun(el.dataset.run)));
}

async function viewPastRun(runId) {
  try {
    const rec = await api(`/api/skills/${detailId}/runs/${runId}`);
    openDrawer(`${rec.skillId}（历史）`, false);
    $("#log-output").textContent = rec.log || "(无输出)";
  } catch (e) { oops(e); }
}

/* ---------- run + live log ---------- */
async function runSkill(id, dryRun) {
  openDrawer(`${id}${dryRun ? "（dry-run）" : ""}`, true);
  $("#log-output").textContent = "";
  try {
    const { runId } = await api(`/api/skills/${id}/run`, { method: "POST", body: { dryRun } });
    currentRunId = runId;
    streamRun(runId);
  } catch (e) { appendLog(`✗ ${e.message}`); }
}
function streamRun(runId) {
  if (currentES) currentES.close();
  const es = new EventSource(`/api/runs/${runId}/stream`);
  currentES = es;
  es.addEventListener("log", (e) => appendLog(e.data));
  es.addEventListener("exit", (e) => {
    appendLog(`\n— 结束（退出码 ${e.data || "?"}）—`);
    es.close(); currentES = null; currentRunId = null;
    loadSkills();
    if (detailId) openDetail(detailId);
  });
}
function appendLog(line) { const o = $("#log-output"); o.textContent += line + "\n"; o.scrollTop = o.scrollHeight; }
function openDrawer(title, cancellable) {
  $("#log-title").textContent = `运行：${title}`;
  $("#log-cancel").style.display = cancellable ? "" : "none";
  $("#log-drawer").hidden = false;
}
$("#log-close").addEventListener("click", () => { if (currentES) currentES.close(); currentES = null; $("#log-drawer").hidden = true; });
$("#log-cancel").addEventListener("click", async () => { if (currentRunId) { try { await api(`/api/runs/${currentRunId}`, { method: "DELETE" }); } catch (e) { oops(e); } } });

/* ---------- import ---------- */
$("#btn-import").addEventListener("click", () => $("#dlg-import").showModal());
$("#imp-submit").addEventListener("click", async () => {
  const path = $("#imp-path").value.trim(), file = $("#imp-zip").files[0];
  if (!path && !file) return;
  try {
    if (file) { const fd = new FormData(); fd.append("file", file); await api("/api/import", { method: "POST", form: fd }); }
    else await api("/api/import", { method: "POST", body: { kind: "folder", path } });
    $("#dlg-import").close(); $("#imp-path").value = ""; $("#imp-zip").value = "";
    toast("导入成功", "success"); loadSkills();
  } catch (e) { oops(e); }
});

/* ---------- delete ---------- */
async function deleteSkill(id) {
  if (!confirm(`删除「${id}」？会移动到 .trash/，不是硬删。`)) return;
  try { await api(`/api/skills/${id}`, { method: "DELETE" }); toast(`已删除 ${id}（在 .trash/）`, "success"); closeDetail(); loadSkills(); }
  catch (e) { oops(e); }
}

/* ---------- reports ---------- */
async function openReports(id, title) {
  try {
    const d = await api(`/api/skills/${id}`);
    if (!d.reports.length) return toast("还没有日报", "error");
    $("#rep-title").textContent = `${title} · 日报`;
    const sel = $("#rep-date");
    sel.innerHTML = d.reports.map((x) => `<option value="${x}">${x}</option>`).join("");
    sel.onchange = () => loadReport(id, sel.value);
    await loadReport(id, d.reports[0]);
    $("#dlg-report").showModal();
  } catch (e) { oops(e); }
}
async function loadReport(id, date) {
  try { const { markdown } = await api(`/api/skills/${id}/report?date=${date}`); $("#rep-body").innerHTML = mdToHtml(markdown); }
  catch (e) { $("#rep-body").textContent = e.message; }
}

/* ---------- boot ---------- */
$("#btn-refresh").addEventListener("click", () => { loadSkills(); refreshHealth(); });
refreshHealth();
loadSkills();
setInterval(refreshHealth, 15000);
