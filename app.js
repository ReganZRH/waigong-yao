"use strict";

const APP = APP_CONFIG;

/* ================= 工具 ================= */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");

function dateStr(d) {
  d = d || nowDate();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
function parseHM(s) { const p = s.split(":").map(Number); return p[0] * 60 + p[1]; }
function hmStr(m) { return pad(Math.floor(m / 60) % 24) + ":" + pad(m % 60); }

const DEMO_TIME = new URLSearchParams(location.search).get("time");
function nowDate() { return DEMO_TIME ? new Date(DEMO_TIME.replace(" ", "T")) : new Date(); }
function nowMins() { const d = nowDate(); return d.getHours() * 60 + d.getMinutes(); }
function isQuiet() {
  const m = nowMins();
  return m >= APP.quietStartHour * 60 || m < APP.quietEndHour * 60;
}
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

/* ================= 本地状态 ================= */
const LS_STATE = "wxcy_state_v1";
const LS_GROUP = "wxcy_group_v1";
const LS_VOICE = "wxcy_voice";
const LS_BIG = "wxcy_big";
const LS_DEVICE = "wxcy_device";

function loadState() {
  try { return JSON.parse(localStorage.getItem(LS_STATE)) || { records: {} }; }
  catch (e) { return { records: {} }; }
}
let state = loadState();
function persistState() { localStorage.setItem(LS_STATE, JSON.stringify(state)); }

function rk(date, slot, med) { return date + "|" + slot + "|" + med; }
function getRec(date, slot, med) { return state.records[rk(date, slot, med)] || null; }
function statusOf(date, slot, med) { const r = getRec(date, slot, med); return r ? r.status : "pending"; }
function slotMeds(slotId) { return APP.slots[slotId] || []; }
function medInfo(name) { return APP.medicines.find((m) => m.name === name) || { name: name, dose: "" }; }
function medLabel(name) {
  const m = medInfo(name);
  return m.dose ? m.name + "（" + m.dose + "）" : m.name;
}
function slotDone(date, slotId) {
  const ms = slotMeds(slotId);
  return ms.length > 0 && ms.every((m) => statusOf(date, slotId, m) !== "pending");
}
function deviceName() { return localStorage.getItem(LS_DEVICE) || "家人"; }

let group = null;
function loadGroup() {
  try { const g = JSON.parse(localStorage.getItem(LS_GROUP)); return g && g.groupId ? g : null; }
  catch (e) { return null; }
}
group = loadGroup();
function saveGroup(g) { localStorage.setItem(LS_GROUP, JSON.stringify(g)); group = g; }

/* ================= 系统通知 ================= */
const hasTriggers = typeof Notification !== "undefined" &&
  "showTrigger" in Notification.prototype &&
  "TimestampTrigger" in window;

async function scheduleAll() {
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || !hasTriggers) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const ns = await reg.getNotifications();
    ns.forEach((n) => { if (n.tag && n.tag.indexOf("wxcy-") === 0) n.close(); });

    const today = nowDate();
    for (let i = 0; i < 3; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const ds = dateStr(d);
      for (const slot of APP.periods) {
        if (slotDone(ds, slot.id)) continue;
        const base = new Date(d);
        base.setHours(0, 0, 0, 0);
        base.setMinutes(parseHM(slot.time));
        for (let step = 0; step < 10; step++) {
          const t = new Date(base.getTime() + step * APP.reRemindHours * 3600000);
          if (t.getHours() >= APP.quietStartHour) break;
          if (t.getTime() <= Date.now()) continue;
          const body = "到时间了：" + slotMeds(slot.id).map(medLabel).join("、") + "，请确认是否已吃";
          new Notification(APP.appName, {
            tag: "wxcy-" + ds + "-" + slot.id,
            body: body,
            icon: "icon-192.png",
            showTrigger: new TimestampTrigger(t)
          });
        }
      }
    }
  } catch (e) { console.warn("scheduleAll:", e); }
}

async function cancelSlotNotifications(ds, slotId) {
  try {
    const reg = await navigator.serviceWorker.ready;
    const ns = await reg.getNotifications();
    ns.forEach((n) => { if (n.tag === "wxcy-" + ds + "-" + slotId) n.close(); });
  } catch (e) { }
}

/* ================= 页内大弹窗 ================= */
let popupShown = false;
let currentDue = null;
const dismissed = {};

function dueInfo() {
  if (isQuiet()) return null;
  const today = dateStr();
  const now = nowMins();
  for (const slot of APP.periods) {
    const base = parseHM(slot.time);
    if (now < base) continue;
    const stepMin = APP.reRemindHours * 60;
    let ws = base;
    while (ws + stepMin <= now && ws + stepMin < APP.quietStartHour * 60) ws += stepMin;
    const meds = slotMeds(slot.id).filter((m) => statusOf(today, slot.id, m) === "pending");
    if (!meds.length) continue;
    const key = today + "|" + slot.id + "|" + ws;
    if (dismissed[key]) continue;
    return { slot: slot, meds: meds, key: key };
  }
  return null;
}

function speak(text) {
  if (localStorage.getItem(LS_VOICE) === "0") return;
  try {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 0.95;
    speechSynthesis.speak(u);
  } catch (e) { }
}

function showPopup(due) {
  currentDue = due;
  popupShown = true;
  $("popupTitle").textContent = due.slot.label + " 吃药时间（" + due.slot.time + "）";
  const wrap = $("popupMeds");
  wrap.innerHTML = "";
  due.meds.forEach((m) => {
    const btn = document.createElement("button");
    btn.className = "med-btn";
    btn.textContent = "💊 " + medLabel(m);
    btn.onclick = () => {
      confirmMed(due.slot.id, m);
      btn.classList.add("done");
      btn.disabled = true;
      btn.textContent = "✓ " + medLabel(m) + " 已确认";
      if (slotMeds(due.slot.id).every((x) => statusOf(dateStr(), due.slot.id, x) !== "pending")) {
        $("popupAllOk").style.display = "block";
        speak("本时段全部确认完成");
        setTimeout(hidePopup, 1800);
      }
    };
    wrap.appendChild(btn);
  });
  $("popupAllOk").style.display = "none";
  $("popup").classList.add("show");
  speak("到吃药时间了，请确认：" + due.meds.map(medLabel).join("、"));
}
function hidePopup() { $("popup").classList.remove("show"); popupShown = false; currentDue = null; }

function setRecord(date, slotId, med, status) {
  const key = rk(date, slotId, med);
  state.records[key] = { status: status, by: deviceName(), ts: Date.now() };
  persistState();
  sync.push(key, state.records[key]);
}

function confirmMed(slotId, med) {
  setRecord(dateStr(), slotId, med, "taken");
  renderTable();
  renderNotify();
  cancelSlotNotifications(dateStr(), slotId);
  scheduleAll();
}

function confirmAllSlot(slotId) {
  const today = dateStr();
  slotMeds(slotId).forEach((m) => {
    if (statusOf(today, slotId, m) === "pending") setRecord(today, slotId, m, "taken");
  });
  cancelSlotNotifications(today, slotId);
  scheduleAll();
  render();
  toast("本时段已全部确认");
}

function skipSlot(slotId) {
  const today = dateStr();
  slotMeds(slotId).forEach((m) => {
    if (statusOf(today, slotId, m) === "pending") setRecord(today, slotId, m, "skipped");
  });
  cancelSlotNotifications(today, slotId);
  scheduleAll();
  render();
  toast("本次已标记跳过");
  hidePopup();
}

/* ================= 渲染 ================= */
function render() {
  renderHeader();
  renderNotify();
  renderSync();
  renderTable();
  renderSettings();
  renderToolbar();
}

function renderHeader() {
  const d = nowDate();
  $("todayStr").textContent = d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + WEEK[d.getDay()];
}

function renderNotify() {
  const box = $("notifyBox");
  if (typeof Notification === "undefined") {
    box.innerHTML = '<div class="notice warn">当前环境不支持系统通知（需要 https 或 localhost）。安装到手机 Chrome 后即可弹窗提醒。</div>';
    return;
  }
  if (Notification.permission === "granted") {
    box.innerHTML = '<div class="notice ok">🔔 系统提醒已开启：6:00 / 12:00 / 18:00 提醒，未确认每 3 小时再提醒一次</div>';
  } else if (Notification.permission === "denied") {
    box.innerHTML = '<div class="notice warn">通知权限被拒绝，请在浏览器设置中允许通知后刷新。</div>';
  } else {
    box.innerHTML = '<button class="btn primary big" id="enableNotifyBtn">🔔 开启吃药提醒</button>';
    $("enableNotifyBtn").onclick = async () => {
      const p = await Notification.requestPermission();
      if (p === "granted") { renderNotify(); scheduleAll(); toast("提醒已开启"); }
    };
  }
}

function renderSync() {
  const enabled = sync.enabled();
  $("syncBanner").style.display = enabled ? "none" : "block";
  setSyncStatus(enabled ? (group ? "ok" : "off") : "off");
}
function setSyncStatus(s) {
  const dot = $("syncDot");
  dot.dataset.st = s;
  dot.title = s === "ok" ? "同步正常" : (s === "err" ? "同步失败，稍后重试" : "未同步");
}

function renderTable() {
  const t = $("medTable");
  const today = dateStr();
  let html = "<thead><tr><th>时间</th>";
  for (const m of APP.medicines) {
    html += "<th><div class=\"col-name\">" + m.name + "</div><div class=\"col-dose\">" + m.dose + "</div></th>";
  }
  html += "<th>操作</th></tr></thead><tbody>";

  for (const slot of APP.periods) {
    html += '<tr><td class="slot-cell"><div class="slot-label">' + slot.label + '</div><div class="slot-time">' + slot.time + "</div></td>";
    for (const m of APP.medicines) {
      if (slotMeds(slot.id).indexOf(m.name) < 0) { html += '<td class="dash">—</td>'; continue; }
      const st = statusOf(today, slot.id, m.name);
      const due = nowMins() >= parseHM(slot.time);
      let cls = "", txt = "";
      if (st === "taken") { cls = "taken"; txt = "✓ 已吃"; }
      else if (st === "skipped") { cls = "skipped"; txt = "跳过"; }
      else if (due) { cls = "missed"; txt = "未吃"; }
      else { cls = "waiting"; txt = "待提醒"; }
      html += '<td class="cell ' + cls + '"><span class="cell-txt">' + txt + "</span></td>";
    }
    html += '<td><button class="btn row-confirm" data-slot="' + slot.id + '">确认本时段</button></td>';
    html += "</tr>";
  }
  html += "</tbody>";
  t.innerHTML = html;
  t.querySelectorAll(".row-confirm").forEach((b) => {
    b.onclick = () => confirmAllSlot(b.dataset.slot);
  });
}

function renderSettings() {
  $("voiceOn").checked = localStorage.getItem(LS_VOICE) !== "0";
  $("bigText").checked = document.documentElement.classList.contains("big");
  $("deviceName").value = deviceName();
  const gb = $("groupBox");
  if (!sync.enabled()) {
    gb.innerHTML = '<p class="small">同步服务未配置：目前为本地模式，提醒功能不受影响。</p>';
  } else if (group) {
    gb.innerHTML = '<h3>家庭组同步</h3><p class="small">家庭组：' + group.groupId + "（已连接）</p>" +
      '<button class="btn danger" id="leaveGroupBtn">退出本机同步</button>';
    $("leaveGroupBtn").onclick = () => {
      if (confirm("退出后本机不再同步，确定？")) {
        localStorage.removeItem(LS_GROUP);
        group = null;
        renderSettings();
      }
    };
  } else {
    gb.innerHTML = "<h3>家庭组同步</h3>" +
      '<p class="small">所有家人手机填同一个 4 位组号和密码。</p>' +
      '<input type="text" id="groupIdInput" maxlength="4" inputmode="numeric" placeholder="组号（4位数字）">' +
      '<input type="password" id="groupSecretInput" maxlength="20" placeholder="密码（至少4位）">' +
      '<div class="btn-row"><button class="btn" id="createGroupBtn">创建新组</button><button class="btn" id="joinGroupBtn">加入已有组</button></div>';
    $("createGroupBtn").onclick = () => groupAction("create");
    $("joinGroupBtn").onclick = () => groupAction("join");
  }
  $("demoInfo").textContent = DEMO_TIME
    ? "测试模式：当前时间被设为 " + DEMO_TIME + "（去掉 ?time= 恢复正常）"
    : "";
}

function renderToolbar() {
  const voiceOn = localStorage.getItem(LS_VOICE) !== "0";
  const bigOn = document.documentElement.classList.contains("big");
  $("voiceChip").classList.toggle("on", voiceOn);
  $("bigChip").classList.toggle("on", bigOn);
}

/* ================= 家人同步 ================= */
const sync = {
  enabled() { return !!(APP.supabaseUrl && APP.supabaseAnonKey); },
  base() { return APP.supabaseUrl.replace(/\/+$/, "") + "/rest/v1"; },
  headersFor(gid, sec) {
    return {
      apikey: APP.supabaseAnonKey,
      Authorization: "Bearer " + APP.supabaseAnonKey,
      "Content-Type": "application/json",
      "X-Group-Id": gid,
      "X-Group-Secret": sec
    };
  },
  headers() { return this.headersFor(group.groupId, group.secret); },

  async pull() {
    if (!this.enabled() || !group) return false;
    try {
      const res = await fetch(this.base() + "/records?group_id=eq." + encodeURIComponent(group.groupId) + "&select=*", {
        headers: this.headers()
      });
      if (!res.ok) throw new Error("status " + res.status);
      const rows = await res.json();
      const serverTs = {};
      let changed = false;
      rows.forEach((r) => {
        if (!r || !r.id) return;
        serverTs[r.id] = r.ts || 0;
        const cur = state.records[r.id];
        if (!cur || (r.ts || 0) > (cur.ts || 0)) {
          state.records[r.id] = { status: r.status, by: r.confirmed_by, ts: r.ts };
          changed = true;
        }
      });
      // 把本机更新、但还没同步到服务器的记录补传上去（断网时也能先记，联网后自动补）
      Object.keys(state.records).forEach((id) => {
        const rec = state.records[id];
        if (!serverTs[id] || rec.ts > serverTs[id]) this.push(id, rec);
      });
      if (changed) { persistState(); render(); scheduleAll(); }
      setSyncStatus("ok");
      return changed;
    } catch (e) {
      setSyncStatus("err");
      return false;
    }
  },

  async push(key, rec) {
    if (!this.enabled() || !group) return;
    const parts = key.split("|");
    try {
      await fetch(this.base() + "/records?on_conflict=id", {
        method: "POST",
        headers: Object.assign({ Prefer: "resolution=merge-duplicates" }, this.headers()),
        body: JSON.stringify([{
          id: key,
          group_id: group.groupId,
          date: parts[0],
          slot: parts[1],
          medicine: parts[2],
          status: rec.status,
          confirmed_by: rec.by,
          ts: rec.ts
        }])
      });
    } catch (e) { }
  }
};

async function groupAction(mode) {
  const gid = ($("groupIdInput").value || "").trim();
  const sec = ($("groupSecretInput").value || "").trim();
  if (!/^\d{4}$/.test(gid)) return toast("组号需要 4 位数字");
  if (sec.length < 4) return toast("密码至少 4 位");
  try {
    const headers = sync.headersFor(gid, sec);
    if (mode === "create") {
      const res = await fetch(sync.base() + "/groups", {
        method: "POST",
        headers: headers,
        body: JSON.stringify([{ group_id: gid, secret: sec }])
      });
      if (res.ok || res.status === 201) {
        saveGroup({ groupId: gid, secret: sec });
        toast("家庭组创建成功");
      } else if (res.status === 409) {
        return toast("组号已存在，请改用“加入已有组”");
      } else {
        return toast("创建失败（" + res.status + "），请检查同步配置");
      }
    } else {
      const res = await fetch(sync.base() + "/groups?group_id=eq." + encodeURIComponent(gid) + "&select=group_id", {
        headers: headers
      });
      const rows = await res.json();
      if (res.ok && Array.isArray(rows) && rows.length) {
        saveGroup({ groupId: gid, secret: sec });
        toast("已加入家庭组 " + gid);
      } else {
        return toast("组号或密码不正确");
      }
    }
    renderSettings();
    sync.pull();
    scheduleAll();
  } catch (e) {
    toast("网络错误，请稍后重试");
  }
}

/* ================= 设置与初始化 ================= */
function bindSettings() {
  $("voiceOn").onchange = (e) => localStorage.setItem(LS_VOICE, e.target.checked ? "1" : "0");
  $("bigText").onchange = (e) => {
    document.documentElement.classList.toggle("big", e.target.checked);
    localStorage.setItem(LS_BIG, e.target.checked ? "1" : "0");
  };
  $("deviceName").onchange = (e) => localStorage.setItem(LS_DEVICE, e.target.value.trim() || "家人");
  $("reSyncBtn").onclick = async () => { await sync.pull(); toast("已同步"); };
  $("clearBtn").onclick = () => {
    if (confirm("确定清除本机所有吃药记录？")) {
      localStorage.removeItem(LS_STATE);
      state = { records: {} };
      render();
      scheduleAll();
      toast("记录已清除");
    }
  };
  $("popupCloseBtn").onclick = () => {
    if (currentDue) dismissed[currentDue.key] = true;
    hidePopup();
  };
  $("popupSkipBtn").onclick = () => {
    if (currentDue) skipSlot(currentDue.slot.id);
  };
  $("voiceChip").onclick = () => {
    const v = localStorage.getItem(LS_VOICE) !== "0";
    localStorage.setItem(LS_VOICE, v ? "0" : "1");
    renderToolbar();
    toast(v ? "语音已关闭" : "语音已开启");
  };
  $("bigChip").onclick = () => {
    const b = document.documentElement.classList.toggle("big");
    localStorage.setItem(LS_BIG, b ? "1" : "0");
    renderToolbar();
  };
  $("settingsChip").onclick = () => { const s = $("settings"); s.open = !s.open; };
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2200);
}

async function init() {
  if (localStorage.getItem(LS_BIG) === "1") document.documentElement.classList.add("big");
  render();
  bindSettings();

  if ("serviceWorker" in navigator) {
    try { navigator.serviceWorker.register("sw.js"); } catch (e) { }
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    $("installBox").style.display = "block";
    $("installBtn").onclick = () => e.prompt();
  });

  if (sync.enabled() && group) {
    sync.pull();
    setInterval(() => sync.pull(), APP.pollIntervalSec * 1000);
  } else if (sync.enabled()) {
    $("settings").open = true;
  }

  scheduleAll();

  setTimeout(() => {
    const d = dueInfo();
    if (d && !popupShown) showPopup(d);
  }, 600);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  render();
  scheduleAll();
  const d = dueInfo();
  if (d && !popupShown) showPopup(d);
});

setInterval(() => {
  renderHeader();
  renderTable();
  const d = dueInfo();
  if (d && !popupShown) showPopup(d);
}, 30000);

init();
