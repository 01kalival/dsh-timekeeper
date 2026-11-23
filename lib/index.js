// dsh-timekeeper 宿主半侧入口（Cordis 插件）
// 职责：从 DSH 启动起自动计时累计时间账本（按天 + 按小时分桶），落盘到
//       <DSH_HOME>/dsh-timekeeper/usage.json，并通过 HTTP 路由把统计、目标、
//       专注、成就、导入导出暴露给浏览器半侧 UI；同时注册 /usage 命令。

import { join, dirname } from "node:path";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

// 不依赖 @deepseek-ai/dsh-home-paths：本插件可能以 file: 链接方式安装，
// 链接包的 peer 依赖不会从 profile 的 node_modules 解析，直接读环境变量最稳。
function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv;
  return join(homedir(), ".dsh");
}

const name = "timekeeper";
const ROUTE_SEGMENT = "/dsh-timekeeper";
const HEARTBEAT_MS = 30 * 1000;
// 单拍最多计入 120 秒（4 个心跳）：正常调度抖动完全够用，而系统休眠 / 挂起 / 时钟跳变
// 造成的大跨度会被截断——用户合盖睡一晚不该被记成「用了 8 小时」。
const MAX_JUMP_SEC = 120;
// 把「两拍之间的秒数」夹到合理区间：非正数/NaN 记 0，超过上限按上限算。
const clampTickSeconds = (raw) => {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return 0;
  return raw > MAX_JUMP_SEC ? MAX_JUMP_SEC : raw;
};
// 分享卡片 base64 上限（PNG 通常 200KB~1.5MB，8MB 足够且防滥用）。
const MAX_SHARE_BYTES = 8 * 1024 * 1024;
// 连续使用追踪：两拍间隔超过这个值就算新的一段；连续用满 REST_REMIND_MINUTES 就提醒休息。
const SESSION_GAP_MS = 5 * 60 * 1000;
const REST_REMIND_MINUTES = 120;
const GOAL_REMIND_HOUR = 20;
const DEFAULT_GOAL_SEC = 2 * 60 * 60;
const MIN_GOAL_SEC = 0;
const MAX_GOAL_SEC = 16 * 60 * 60;
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

const inject = ["webServer", "commands"];

function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// 从会话的 cwd 取一个短标签当作「项目名」，取不到就归到「其他」。
function projectLabelOf(cwd) {
  if (typeof cwd !== "string" || cwd.trim() === "") return "其他";
  const parts = cwd.replace(/\\/g, "/").split("/").filter((p) => p !== "");
  const last = parts.length > 0 ? parts[parts.length - 1] : "";
  if (last === "" || /^[A-Za-z]:$/.test(last)) return "其他";
  return last.slice(0, 40);
}

function emptyState() {
  return {
    version: 2,
    days: {},
    hours: {},
    focus: {},
    projects: {},
    shareCount: 0,
    goal: { dailySeconds: DEFAULT_GOAL_SEC },
    // 当前这段连续使用的起止时刻（毫秒时间戳，0 表示还没开始）
    session: { startAt: 0, lastAt: 0 }
  };
}

// 连续使用：{ startAt, lastAt }，非法的字段一律归零。
function normalizeSession(raw) {
  const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  if (!raw || typeof raw !== "object") return { startAt: 0, lastAt: 0 };
  const startAt = num(raw.startAt);
  const lastAt = num(raw.lastAt);
  if (startAt === 0 || lastAt === 0 || lastAt < startAt) return { startAt: 0, lastAt: 0 };
  return { startAt, lastAt };
}

// 项目归属：{ "2026-11-23": { "DSHTask": 1234, "game": 567 } }
function normalizeProjectMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key in raw) {
    if (!DAY_RE.test(key)) continue;
    const bucket = raw[key];
    if (!bucket || typeof bucket !== "object") continue;
    const clean = {};
    for (const name in bucket) {
      const v = bucket[name];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) clean[String(name).slice(0, 60)] = v;
    }
    if (Object.keys(clean).length > 0) out[key] = clean;
  }
  return out;
}

function normalizeDayMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key in raw) {
    if (!DAY_RE.test(key)) continue;
    const v = raw[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[key] = v;
  }
  return out;
}

function normalizeHourMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key in raw) {
    if (!DAY_RE.test(key)) continue;
    const buckets = raw[key];
    if (!buckets || typeof buckets !== "object") continue;
    const clean = {};
    for (let i = 0; i < 24; i++) {
      const v = buckets[String(i)];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) clean[String(i)] = v;
    }
    if (Object.keys(clean).length > 0) out[key] = clean;
  }
  return out;
}

function normalizeFocusMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key in raw) {
    if (!DAY_RE.test(key)) continue;
    const item = raw[key];
    if (!item || typeof item !== "object") continue;
    const seconds = typeof item.seconds === "number" && item.seconds > 0 ? item.seconds : 0;
    const sessions = typeof item.sessions === "number" && item.sessions > 0 ? Math.floor(item.sessions) : 0;
    if (seconds > 0 || sessions > 0) out[key] = { seconds, sessions };
  }
  return out;
}

// 兼容 v1（只有 days）与 v2（多小时分桶 / 专注 / 目标 / 分享计数 / 项目归属）。
function loadState(file) {
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.days && typeof parsed.days === "object") {
        const base = emptyState();
        const goalSec = parsed.goal && typeof parsed.goal.dailySeconds === "number" ? parsed.goal.dailySeconds : DEFAULT_GOAL_SEC;
        return {
          version: 2,
          days: normalizeDayMap(parsed.days),
          hours: normalizeHourMap(parsed.hours),
          focus: normalizeFocusMap(parsed.focus),
          projects: normalizeProjectMap(parsed.projects),
          shareCount: typeof parsed.shareCount === "number" && parsed.shareCount > 0 ? Math.floor(parsed.shareCount) : 0,
          goal: { dailySeconds: Math.min(MAX_GOAL_SEC, Math.max(MIN_GOAL_SEC, Math.round(goalSec))) },
          session: normalizeSession(parsed.session),
          ...(base.version === 2 ? {} : {})
        };
      }
    }
  } catch {
    /* 损坏或缺失时重建 */
  }
  return emptyState();
}

function saveState(file, state) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(state), "utf8");
    renameSync(tmp, file);
  } catch {
    /* 落盘失败时保留内存态，下一拍再试 */
  }
}

// 一段区间（含今天往前 offset 天起的 n 天）的秒数合计。
function sumWindow(days, now, n, offset) {
  let sum = 0;
  for (let i = offset; i < offset + n; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    sum += typeof days[dayKey(d)] === "number" ? days[dayKey(d)] : 0;
  }
  return sum;
}

function compareOf(cur, prev) {
  const pct = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
  return { cur: Math.round(cur), prev: Math.round(prev), pct };
}

function longestStreak(activeKeys) {
  if (activeKeys.length === 0) return 0;
  const sorted = activeKeys.slice().sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + "T00:00:00");
    prev.setDate(prev.getDate() + 1);
    if (dayKey(prev) === sorted[i]) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return best;
}

function computeBadges(state, info) {
  const { hoursTotal, streak, bestSeconds, activeDays, longest, shareCount, total } = info;
  const sumSeg = (from, to) => {
    let s = 0;
    for (let i = from; i <= to; i++) s += hoursTotal[i];
    return s;
  };
  const list = [];
  const push = (id, name, desc, cur, target, icon, unit) => {
    list.push({
      id,
      name,
      desc,
      icon,
      unit,
      earned: cur >= target,
      cur: Math.round(Math.min(cur, target)),
      target: Math.round(target)
    });
  };
  push("first-hour", "初次上机", "累计使用满 1 小时", total, 3600, "🌱", "time");
  push("ten-hours", "十小时俱乐部", "累计使用满 10 小时", total, 36000, "🔟", "time");
  push("fifty-hours", "五十小时", "累计使用满 50 小时", total, 180000, "🏅", "time");
  push("hundred-hours", "百小时", "累计使用满 100 小时", total, 360000, "💯", "time");
  push("streak-3", "三日不断", "连续使用 3 天", streak, 3, "🔥", "days");
  push("streak-7", "一周不断", "连续使用 7 天", streak, 7, "📅", "days");
  push("streak-30", "满月坚持", "连续使用 30 天", longest, 30, "🌕", "days");
  push("day-4h", "马拉松", "单日使用满 4 小时", bestSeconds, 14400, "🏃", "time");
  push("early-bird", "早起鸟", "凌晨 5-8 点累计使用满 30 分钟", sumSeg(5, 8), 1800, "🌅", "time");
  push("night-owl", "夜猫子", "深夜 0-3 点累计使用满 30 分钟", sumSeg(0, 3), 1800, "🌙", "time");
  push("week-full", "周满勤", "某一周 7 天都有使用记录", info.fullWeek ? 1 : 0, 1, "🗓️", "count");
  push("sharer", "传播者", "生成过 1 次分享卡片", shareCount, 1, "📤", "count");
  return list;
}

function hasFullWeek(activeKeys) {
  if (activeKeys.length < 7) return false;
  const set = new Set(activeKeys);
  for (const key of activeKeys) {
    const d = new Date(key + "T00:00:00");
    // 以周一为一周起点
    const wd = (d.getDay() + 6) % 7;
    const monday = new Date(d);
    monday.setDate(monday.getDate() - wd);
    let all = true;
    for (let i = 0; i < 7; i++) {
      const x = new Date(monday);
      x.setDate(x.getDate() + i);
      if (!set.has(dayKey(x))) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

function computeStats(state, now = new Date()) {
  const days = state.days || {};
  const hours = state.hours || {};
  const focusMap = state.focus || {};
  const num = (k) => (typeof days[k] === "number" && days[k] > 0 ? days[k] : 0);

  const todayKey = dayKey(now);
  const today = num(todayKey);

  let total = 0;
  for (const k in days) total += num(k);

  const week = sumWindow(days, now, 7, 0);
  const prevWeek = sumWindow(days, now, 7, 7);
  const prevDay = sumWindow(days, now, 1, 1);

  const monthPrefix = todayKey.slice(0, 7);
  let month = 0;
  for (const k in days) if (k.startsWith(monthPrefix)) month += num(k);

  const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthPrefix = `${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, "0")}`;
  let prevMonth = 0;
  for (const k in days) if (k.startsWith(prevMonthPrefix)) prevMonth += num(k);

  const yearPrefix = todayKey.slice(0, 4);
  let year = 0;
  for (const k in days) if (k.startsWith(yearPrefix)) year += num(k);

  // 连续使用天数：今天还没用到就从昨天开始往回数，避免"今天刚开始就断签"。
  const active = new Set(Object.keys(days).filter((k) => num(k) > 0));
  let streak = 0;
  const cursor = new Date(now);
  if (!active.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (active.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // 最近 365 天明细（热力图用），最旧在前。
  const list = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const k = dayKey(d);
    list.push({ date: k, seconds: Math.round(num(k)) });
  }

  let firstDay = null;
  let bestDay = null;
  let bestSeconds = 0;
  for (const k in days) {
    const v = num(k);
    if (v <= 0) continue;
    if (firstDay === null || k < firstDay) firstDay = k;
    if (v > bestSeconds) {
      bestSeconds = v;
      bestDay = k;
    }
  }

  // 时段分桶聚合：总分布 / 今日分布 / 周内分布
  const hoursTotal = new Array(24).fill(0);
  const todayHours = new Array(24).fill(0);
  const weekdayTotal = new Array(7).fill(0);
  let hoursDays = 0;
  for (const k in hours) {
    const buckets = hours[k];
    if (!buckets || typeof buckets !== "object") continue;
    let touched = false;
    for (let i = 0; i < 24; i++) {
      const v = buckets[String(i)];
      if (typeof v === "number" && v > 0) {
        hoursTotal[i] += v;
        if (k === todayKey) todayHours[i] += v;
        touched = true;
      }
    }
    if (touched) hoursDays += 1;
  }
  for (const k in days) {
    const v = num(k);
    if (v <= 0) continue;
    const wd = new Date(k + "T00:00:00").getDay();
    weekdayTotal[wd] += v;
  }

  const sumH = hoursTotal.reduce((a, b) => a + b, 0);
  let profile = null;
  if (sumH > 0) {
    const seg = (from, to) => {
      let s = 0;
      for (let i = from; i <= to; i++) s += hoursTotal[i];
      return s;
    };
    const parts = [
      ["夜猫子型", seg(0, 4)],
      ["早起鸟型", seg(5, 8)],
      ["白天型", seg(9, 17)],
      ["夜间型", seg(18, 23)]
    ];
    parts.sort((a, b) => b[1] - a[1]);
    profile = { label: parts[0][0], share: Math.round((parts[0][1] / sumH) * 100) };
  }

  let peakHour = null;
  let peakSeconds = 0;
  for (let i = 0; i < 24; i++) {
    if (hoursTotal[i] > peakSeconds) {
      peakSeconds = hoursTotal[i];
      peakHour = i;
    }
  }

  // 项目归属聚合：今日排名 + 累计排名（前 6 名，其余合并为「其他」）
  const projectMap = state.projects || {};
  const todayProjects = {};
  const allProjects = {};
  for (const k in projectMap) {
    const bucket = projectMap[k];
    if (!bucket || typeof bucket !== "object") continue;
    for (const name in bucket) {
      const v = bucket[name];
      if (typeof v !== "number" || v <= 0) continue;
      allProjects[name] = (allProjects[name] || 0) + v;
      if (k === todayKey) todayProjects[name] = (todayProjects[name] || 0) + v;
    }
  }
  const rankProjects = (map, base) => {
    const items = Object.keys(map)
      .map((name) => ({ name, seconds: map[name] }))
      .sort((a, b) => b.seconds - a.seconds);
    const out = [];
    let rest = 0;
    for (const item of items) {
      if (out.length < 6) {
        out.push({
          name: item.name,
          seconds: Math.round(item.seconds),
          pct: base > 0 ? Math.round((item.seconds / base) * 100) : 0
        });
      } else {
        rest += item.seconds;
      }
    }
    if (rest > 0) out.push({ name: "其他", seconds: Math.round(rest), pct: base > 0 ? Math.round((rest / base) * 100) : 0 });
    return out;
  };
  const projects = {
    today: rankProjects(todayProjects, today),
    total: rankProjects(allProjects, total),
    todayTracked: Math.round(Object.keys(todayProjects).reduce((a, k) => a + todayProjects[k], 0)),
    days: Object.keys(projectMap).length
  };

  const activeDays = active.size;
  const longest = longestStreak(Array.from(active));
  const fullWeek = hasFullWeek(Array.from(active));

  const goalSeconds = state.goal && typeof state.goal.dailySeconds === "number"
    ? state.goal.dailySeconds
    : DEFAULT_GOAL_SEC;
  const goalPct = goalSeconds > 0 ? Math.min(100, Math.round((today / goalSeconds) * 100)) : 0;
  const goalRemaining = Math.max(0, goalSeconds - Math.round(today));
  const goalMet = goalSeconds > 0 && today >= goalSeconds;

  // 连续使用：只有最近一拍还在心跳窗口内才算「正在进行的一段」。
  const sessionRaw = normalizeSession(state.session);
  const sessionActive = sessionRaw.lastAt > 0 && now.getTime() - sessionRaw.lastAt <= SESSION_GAP_MS;
  const sessionMinutes = sessionActive ? Math.max(0, Math.round((now.getTime() - sessionRaw.startAt) / 60000)) : 0;
  const session = {
    minutes: sessionMinutes,
    startAt: sessionActive ? sessionRaw.startAt : null,
    active: sessionActive
  };

  // 提醒：宿主统一算好文案，面板与 /usage 用同一套判断，避免各处规则漂移。
  const reminders = [];
  if (sessionActive && sessionMinutes >= REST_REMIND_MINUTES) {
    reminders.push({ kind: "rest", text: "已连续使用 " + fmtDuration(sessionMinutes * 60) + "，起来活动 5 分钟吧" });
  }
  const hourNow = now.getHours();
  if (goalSeconds > 0 && !goalMet && hourNow >= GOAL_REMIND_HOUR && goalRemaining > 0) {
    reminders.push({ kind: "goal", text: "今天目标还差 " + fmtDuration(goalRemaining) + "，已经 " + hourNow + " 点了" });
  }
  if (goalMet) {
    reminders.push({ kind: "done", text: "今天的 " + fmtDuration(goalSeconds) + " 目标达成，喝口水庆祝一下" });
  }

  let focusToday = { seconds: 0, sessions: 0 };
  let focusTotal = { seconds: 0, sessions: 0 };
  for (const k in focusMap) {
    const item = focusMap[k];
    if (!item) continue;
    focusTotal.seconds += item.seconds || 0;
    focusTotal.sessions += item.sessions || 0;
    if (k === todayKey) {
      focusToday.seconds += item.seconds || 0;
      focusToday.sessions += item.sessions || 0;
    }
  }

  const badges = computeBadges(state, {
    hoursTotal,
    streak,
    bestSeconds,
    activeDays,
    longest,
    fullWeek,
    shareCount: typeof state.shareCount === "number" ? state.shareCount : 0,
    total
  });

  return {
    total: Math.round(total),
    today: Math.round(today),
    week: Math.round(week),
    month: Math.round(month),
    year: Math.round(year),
    streak,
    days: list,
    firstDay,
    bestDay,
    bestSeconds: Math.round(bestSeconds),
    compare: {
      today: compareOf(today, prevDay),
      week: compareOf(week, prevWeek),
      month: compareOf(month, prevMonth)
    },
    hours: { total: hoursTotal.map((v) => Math.round(v)), today: todayHours.map((v) => Math.round(v)), weekday: weekdayTotal.map((v) => Math.round(v)) },
    hoursDays,
    profile,
    peakHour,
    peakSeconds: Math.round(peakSeconds),
    activeDays,
    averagePerActiveDay: activeDays > 0 ? Math.round(total / activeDays) : 0,
    longestStreak: longest,
    goal: {
      dailySeconds: goalSeconds,
      todayPct: goalPct,
      remaining: goalRemaining,
      met: goalMet
    },
    focus: {
      today: { seconds: Math.round(focusToday.seconds), sessions: focusToday.sessions },
      total: { seconds: Math.round(focusTotal.seconds), sessions: focusTotal.sessions }
    },
    badges,
    projects,
    session,
    reminders,
    shareCount: typeof state.shareCount === "number" ? state.shareCount : 0
  };
}

function fmtDuration(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s % 60} 秒`;
  return `${s} 秒`;
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 读取请求体（分享卡片上传 / 数据导入）。超限直接拒绝，避免大体积请求打爆内存。
function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.setHeader("Cache-Control", "no-store");
  // 浏览器半侧可能跑在 dsh-app:// 自定义 scheme 下，跨源读取需要这一条。
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(body);
}

function apply(ctx) {
  const dataFile = join(resolveDshHome(), "dsh-timekeeper", "usage.json");
  const diagFile = join(resolveDshHome(), "dsh-timekeeper", "client-diag.jsonl");
  const state = loadState(dataFile);
  let lastTick = Date.now();
  // 当前归属的项目（由最近的会话事件决定），心跳把增量记到它名下。
  let activeProject = null;
  let projectEventLogged = false;

  const appendDiag = (text) => {
    try {
      mkdirSync(dirname(diagFile), { recursive: true });
      appendFileSync(diagFile, JSON.stringify({ t: new Date().toISOString(), e: String(text).slice(0, 600) }) + "\n", "utf8");
    } catch {
      /* 诊断落盘失败不影响主流程 */
    }
  };

  const readDiag = () => {
    try {
      if (!existsSync(diagFile)) return [];
      const lines = readFileSync(diagFile, "utf8").split("\n").filter(Boolean);
      return lines.slice(-80).map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { t: "", e: line };
        }
      });
    } catch {
      return [];
    }
  };

  const flush = () => {
    const nowMs = Date.now();
    let elapsed = (nowMs - lastTick) / 1000;
    lastTick = nowMs;
    if (elapsed <= 0) return;
    const clamped = clampTickSeconds(elapsed);
    if (clamped !== elapsed) {
      // 截断说明机器刚被挂起 / 时钟跳变，这一拍不算真实使用时间。
      const raw = Math.round(elapsed);
      elapsed = clamped;
      if (raw > 600) appendDiag("flush: 单拍 " + raw + "s 被截断为 " + elapsed + "s（休眠/挂起？）");
    }
    // 连续使用追踪：超过一个心跳间隔的断档就重开一段。
    if (!state.session || typeof state.session !== "object") state.session = { startAt: 0, lastAt: 0 };
    if (state.session.lastAt === 0 || nowMs - state.session.lastAt > SESSION_GAP_MS) {
      state.session.startAt = nowMs;
    }
    state.session.lastAt = nowMs;
    const now = new Date();
    const k = dayKey(now);
    state.days[k] = (typeof state.days[k] === "number" ? state.days[k] : 0) + elapsed;
    const hk = String(now.getHours());
    const dayHours = state.hours[k] || (state.hours[k] = {});
    dayHours[hk] = (typeof dayHours[hk] === "number" ? dayHours[hk] : 0) + elapsed;
    // 项目归属：把这一拍的时长记到最近活跃会话所属的工作区名下。
    const projectKey = activeProject !== null ? activeProject : "其他";
    const dayProjects = state.projects[k] || (state.projects[k] = {});
    dayProjects[projectKey] = (typeof dayProjects[projectKey] === "number" ? dayProjects[projectKey] : 0) + elapsed;
    saveState(dataFile, state);
  };

  // 会话只要发生活动，就把「当前项目」切到它所属的工作区。
  const noteSession = (session) => {
    try {
      const header = session && session.header ? session.header : session;
      if (!header || typeof header !== "object") return;
      if (!projectEventLogged) {
        projectEventLogged = true;
        appendDiag("project: 收到会话事件，header 字段=" + Object.keys(header).join(","));
      }
      if (typeof header.cwd === "string" && header.cwd !== "") {
        activeProject = projectLabelOf(header.cwd);
      }
    } catch {
      /* 会话事件异常不影响计时 */
    }
  };
  ctx.on?.("session/event", (session) => noteSession(session));
  ctx.on?.("session/created", (session) => noteSession(session));

  const timer = setInterval(flush, HEARTBEAT_MS);
  timer.unref?.();

  const jsonBody = (req) => readBody(req, MAX_IMPORT_BYTES * 2).then((text) => JSON.parse(text));

  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: ROUTE_SEGMENT,
    handler: (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const rest = decodeURIComponent(url.pathname.slice(ROUTE_SEGMENT.length + 1));
        const method = req.method ?? "GET";

        // 浏览器半侧跑在 dsh-app:// 下，POST 会先发预检；这里统一放行。
        if (method === "OPTIONS") {
          res.statusCode = 204;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");
          res.setHeader("Access-Control-Max-Age", "600");
          res.end();
          return;
        }

        if (rest === "client-diag") {
          const e = url.searchParams.get("e");
          if (e) {
            appendDiag(e);
            sendJson(res, 200, { ok: true });
          } else {
            sendJson(res, 200, { events: readDiag() });
          }
          return;
        }

        // 分享卡片：客户端把 canvas 导出的 dataURL 传上来，宿主落成真实 PNG 文件。
        if (method === "POST" && rest === "share") {
          jsonBody(req).then((payload) => {
            const dataUrl = payload && typeof payload.dataUrl === "string" ? payload.dataUrl : "";
            const matched = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
            if (matched === null) {
              sendJson(res, 400, { error: "只接受 data:image/png;base64 形式" });
              return;
            }
            const bytes = Buffer.from(matched[1], "base64");
            if (bytes.length < 1024 || bytes.length > MAX_SHARE_BYTES) {
              sendJson(res, 400, { error: `图片体积异常（${bytes.length} 字节）` });
              return;
            }
            const dir = join(resolveDshHome(), "dsh-timekeeper", "share");
            mkdirSync(dir, { recursive: true });
            const file = join(dir, `usage-card-${stamp()}.png`);
            writeFileSync(file, bytes);
            state.shareCount = (typeof state.shareCount === "number" ? state.shareCount : 0) + 1;
            saveState(dataFile, state);
            appendDiag(`share: 已保存 ${file}（${bytes.length} 字节）`);
            sendJson(res, 200, { ok: true, path: file, bytes: bytes.length });
          }).catch((e) => {
            const message = e instanceof Error ? e.message : String(e);
            appendDiag(`share: 保存失败 ${message}`);
            sendJson(res, message === "body too large" ? 413 : 500, { error: message });
          });
          return;
        }

        // 每日目标：{ dailySeconds: 0..16h }
        if (method === "POST" && rest === "goal") {
          jsonBody(req).then((payload) => {
            const v = payload && typeof payload.dailySeconds === "number" ? payload.dailySeconds : NaN;
            if (!Number.isFinite(v) || v < MIN_GOAL_SEC || v > MAX_GOAL_SEC) {
              sendJson(res, 400, { error: "dailySeconds 需在 0 ~ 57600 之间" });
              return;
            }
            state.goal = { dailySeconds: Math.round(v) };
            saveState(dataFile, state);
            sendJson(res, 200, { ok: true, goal: state.goal });
          }).catch((e) => sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) }));
          return;
        }

        // 专注时段：完成一个番茄钟后累加 { seconds, sessions }
        if (method === "POST" && rest === "focus") {
          jsonBody(req).then((payload) => {
            const seconds = payload && typeof payload.seconds === "number" ? payload.seconds : 0;
            const sessions = payload && typeof payload.sessions === "number" ? Math.floor(payload.sessions) : 1;
            if (!Number.isFinite(seconds) || seconds < 30 || seconds > 6 * 60 * 60) {
              sendJson(res, 400, { error: "seconds 需在 30 ~ 21600 之间" });
              return;
            }
            const k = dayKey(new Date());
            const item = state.focus[k] || (state.focus[k] = { seconds: 0, sessions: 0 });
            item.seconds += Math.round(seconds);
            item.sessions += Math.max(1, Math.min(10, sessions));
            saveState(dataFile, state);
            sendJson(res, 200, { ok: true, focus: item });
          }).catch((e) => sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) }));
          return;
        }

        // 导出：返回完整原始状态，客户端自己拼成可下载的 JSON 文件。
        if (method === "GET" && rest === "export") {
          sendJson(res, 200, { ok: true, exportedAt: new Date().toISOString(), state });
          return;
        }

        // 导入：整体替换状态（先做结构与数值校验）。
        if (method === "POST" && rest === "import") {
          jsonBody(req).then((payload) => {
            const raw = payload && typeof payload === "object" && payload.state ? payload.state : payload;
            if (!raw || typeof raw !== "object" || !raw.days || typeof raw.days !== "object") {
              sendJson(res, 400, { error: "导入数据缺少 days 字段" });
              return;
            }
            const next = emptyState();
            next.days = normalizeDayMap(raw.days);
            next.hours = normalizeHourMap(raw.hours);
            next.focus = normalizeFocusMap(raw.focus);
            next.projects = normalizeProjectMap(raw.projects);
            next.shareCount = typeof raw.shareCount === "number" && raw.shareCount > 0 ? Math.floor(raw.shareCount) : 0;
            const goalSec = raw.goal && typeof raw.goal.dailySeconds === "number" ? raw.goal.dailySeconds : DEFAULT_GOAL_SEC;
            next.goal = { dailySeconds: Math.min(MAX_GOAL_SEC, Math.max(MIN_GOAL_SEC, Math.round(goalSec))) };
            const dayCount = Object.keys(next.days).length;
            if (dayCount === 0) {
              sendJson(res, 400, { error: "导入数据里没有合法的日期记录" });
              return;
            }
            state.version = 2;
            state.days = next.days;
            state.hours = next.hours;
            state.focus = next.focus;
            state.projects = next.projects;
            state.shareCount = next.shareCount;
            state.goal = next.goal;
            state.session = { startAt: 0, lastAt: 0 };
            saveState(dataFile, state);
            appendDiag(`import: 已导入 ${dayCount} 天记录`);
            sendJson(res, 200, { ok: true, days: dayCount, hours: Object.keys(next.hours).length });
          }).catch((e) => {
            const message = e instanceof Error ? e.message : String(e);
            sendJson(res, message === "body too large" ? 413 : 500, { error: message });
          });
          return;
        }

        // 清空：必须带 confirm:true，防止误触。
        if (method === "POST" && rest === "reset") {
          jsonBody(req).then((payload) => {
            if (!payload || payload.confirm !== true) {
              sendJson(res, 400, { error: "需要 confirm:true 才能清空数据" });
              return;
            }
            state.days = {};
            state.hours = {};
            state.focus = {};
            state.projects = {};
            state.shareCount = 0;
            state.session = { startAt: 0, lastAt: 0 };
            saveState(dataFile, state);
            appendDiag("reset: 用户清空了全部统计数据");
            sendJson(res, 200, { ok: true });
          }).catch((e) => sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) }));
          return;
        }

        if (method === "GET" && (rest === "stats" || rest === "")) {
          flush();
          sendJson(res, 200, computeStats(state));
          return;
        }
        sendJson(res, 404, { error: "not found" });
      } catch (e) {
        ctx.logger?.warn?.(`[dsh-timekeeper] route failed: ${e instanceof Error ? e.message : String(e)}`);
        if (!res.destroyed && !res.writableEnded) {
          sendJson(res, 500, { error: "internal error" });
        }
      }
    }
  }), "dsh-timekeeper: stats route");

  ctx.effect(() => ctx.commands.register({
    name: "usage",
    description: "查看 DeepSeek 时间账本统计（今日 / 本周 / 本月 / 累计 / 连续天数 / 目标）",
    input: { hint: "（留空 = 查看统计）" },
    handler: () => {
      flush();
      const s = computeStats(state);
      const earned = s.badges.filter((b) => b.earned).length;
      const topProject = s.projects.today.length > 0 ? s.projects.today[0] : null;
      const goalLine = s.goal.dailySeconds > 0
        ? `今日目标：${s.goal.todayPct}%（${fmtDuration(s.today)} / ${fmtDuration(s.goal.dailySeconds)}）`
        : "今日目标：未设置";
      const text = [
        "DeepSeek 时间账本",
        `今日：${fmtDuration(s.today)}`,
        goalLine,
        `本周：${fmtDuration(s.week)}`,
        `本月：${fmtDuration(s.month)}`,
        `累计：${fmtDuration(s.total)}`,
        `连续使用：${s.streak} 天`,
        s.session.minutes > 0 ? `本次连续：${fmtDuration(s.session.minutes * 60)}` : "本次连续：刚刚开始",
        `成就：${earned}/${s.badges.length}`,
        topProject ? `今日主要项目：${topProject.name}（${topProject.pct}%）` : "今日主要项目：暂无归属",
        s.profile ? `时段画像：${s.profile.label}` : "时段画像：数据不足",
        ...(s.reminders.length > 0 ? ["—— " + s.reminders.map((r) => r.text).join("；")] : [])
      ].join("\n");
      return { kind: "success", text };
    }
  }), "dsh-timekeeper: /usage command");

  ctx.effect(() => () => {
    clearInterval(timer);
    flush();
  });
}

export { apply, inject, name };
export { computeStats, dayKey, clampTickSeconds };
