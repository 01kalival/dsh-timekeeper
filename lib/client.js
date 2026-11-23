// dsh-timekeeper 浏览器半侧入口（Cordis 插件）
// 职责：在右侧栏注册"时间账本"标签页，从宿主 HTTP 路由拉取统计并渲染
//       四维面板 / 环比 / 时段洞察 / 成就徽章 / 每日目标 / 番茄钟 / 热力图 / 年度小结 / 分享卡片 / 数据管理。
// 诊断：关键阶段向宿主 /dsh-timekeeper/client-diag 打点，便于无浏览器控制时定位问题。

;(() => {
  const ROUTE_SEGMENT = "/dsh-timekeeper";

  function mountPrefixOf(baseURI) {
    if (!baseURI) return "";
    try {
      const u = new URL(baseURI);
      return u.protocol === "http:" || u.protocol === "https:" ? u.pathname.replace(/\/+$/, "") : "";
    } catch {
      return "";
    }
  }

  const BASE_PATH = mountPrefixOf(typeof document === "undefined" ? void 0 : document.baseURI);
  const ROUTE_PATH = BASE_PATH + ROUTE_SEGMENT;

  // 诊断打点：失败静默，绝不影响插件本体。
  function diag(msg) {
    try {
      if (typeof fetch !== "function") return;
      const text = String(msg).slice(0, 600);
      fetch(ROUTE_PATH + "/client-diag?e=" + encodeURIComponent(text), { cache: "no-store" }).catch(() => {});
    } catch {
      /* 忽略 */
    }
  }

  const TAB_ID = "dsh-timekeeper";
  const TAB_KIND = "timekeeper";
  const AUTO_OPEN_FLAG = "dsh-timekeeper:auto-opened";

  function makeFactory() {
    return (require) => {
      const react = require("react");
      const { useEffect, useRef, useState } = react;
      const { jsx: h } = require("react/jsx-runtime");

      const CSS = [
        ".upt-panel{font-family:system-ui,-apple-system,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;color:var(--dsw-alias-text-primary,#e5e7eb);padding:16px;display:flex;flex-direction:column;gap:14px;box-sizing:border-box;height:100%;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}",
        ".upt-panel>*{flex:0 0 auto}",
        ".upt-head{display:flex;align-items:center;justify-content:space-between;gap:8px}",
        ".upt-title{font-size:16px;font-weight:700;color:var(--dsw-alias-text-primary,#f9fafb)}",
        ".upt-chip{font-size:11px;padding:3px 9px;border-radius:999px;background:rgba(96,165,250,.14);color:#93c5fd;border:1px solid rgba(96,165,250,.3);white-space:nowrap}",
        ".upt-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
        ".upt-card{background:var(--dsw-alias-bg-elevated,#1f2937);border:1px solid var(--dsw-alias-border-subtle,#374151);border-radius:10px;padding:12px 14px}",
        ".upt-card-label{font-size:12px;color:var(--dsw-alias-text-secondary,#9ca3af);margin-bottom:4px}",
        ".upt-card-value{font-size:18px;font-weight:700;color:var(--dsw-alias-accent,#60a5fa)}",
        ".upt-delta{font-size:11px;margin-left:6px;font-weight:600}",
        ".upt-delta.up{color:#34d399}",
        ".upt-delta.down{color:#f87171}",
        ".upt-delta.flat{color:var(--dsw-alias-text-secondary,#9ca3af)}",
        ".upt-streak{font-size:13px;color:#fbbf24;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25);border-radius:8px;padding:8px 12px}",
        ".upt-tips{display:flex;flex-direction:column;gap:6px}",
        ".upt-tip{font-size:12px;line-height:1.5;border-radius:8px;padding:8px 12px;border:1px solid transparent}",
        ".upt-tip-rest{color:#fca5a5;background:rgba(248,113,113,.1);border-color:rgba(248,113,113,.3)}",
        ".upt-tip-goal{color:#fdba74;background:rgba(251,146,60,.1);border-color:rgba(251,146,60,.3)}",
        ".upt-tip-done{color:#6ee7b7;background:rgba(52,211,153,.1);border-color:rgba(52,211,153,.3)}",
        ".upt-section-title{font-size:13px;font-weight:600;color:var(--dsw-alias-text-secondary,#d1d5db);margin-top:2px}",
        ".upt-goal{background:var(--dsw-alias-bg-elevated,#111827);border:1px solid var(--dsw-alias-border-subtle,#1f2937);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}",
        ".upt-goal-top{display:flex;justify-content:space-between;font-size:12px;color:var(--dsw-alias-text-secondary,#9ca3af)}",
        ".upt-bar{height:8px;border-radius:999px;background:rgba(148,163,184,.2);overflow:hidden}",
        ".upt-bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#2563eb,#60a5fa)}",
        ".upt-bar-fill.met{background:linear-gradient(90deg,#059669,#34d399)}",
        ".upt-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
        ".upt-input,.upt-select{appearance:none;background:rgba(148,163,184,.1);color:inherit;border:1px solid var(--dsw-alias-border-subtle,#374151);border-radius:8px;padding:6px 8px;font-size:12px;font-family:inherit;min-width:64px}",
        ".upt-input{width:64px}",
        ".upt-bars{display:flex;align-items:flex-end;gap:2px;height:64px;padding-top:2px}",
        ".upt-bar-col{flex:1 1 0;display:flex;flex-direction:column;justify-content:flex-end;height:100%}",
        ".upt-bar-seg{background:#3b82f6;border-radius:2px 2px 0 0;min-height:1px}",
        ".upt-bar-seg.peak{background:#93c5fd}",
        ".upt-axis{display:flex;gap:2px;font-size:9px;color:var(--dsw-alias-text-secondary,#9ca3af);margin-top:2px}",
        ".upt-axis>span{flex:1 1 0;text-align:center}",
        ".upt-badges{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}",        ".upt-badge{background:var(--dsw-alias-bg-elevated,#1f2937);border:1px solid var(--dsw-alias-border-subtle,#374151);border-radius:9px;padding:8px 9px;display:flex;flex-direction:column;gap:2px}",
        ".upt-badge.earned{border-color:rgba(251,191,36,.45);background:rgba(251,191,36,.08)}",
        ".upt-badge.locked{opacity:.55}",
        ".upt-badge-icon{font-size:16px;line-height:1.1}",
        ".upt-badge-name{font-size:11px;font-weight:700}",
        ".upt-badge-prog{font-size:10px;color:var(--dsw-alias-text-secondary,#9ca3af)}",
        ".upt-proj{display:flex;flex-direction:column;gap:6px}",
        ".upt-proj-row{display:flex;align-items:center;gap:8px;font-size:12px}",
        ".upt-proj-name{flex:0 0 96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-text-primary,#e5e7eb)}",
        ".upt-proj-track{flex:1 1 auto;height:8px;border-radius:999px;background:rgba(148,163,184,.18);overflow:hidden}",
        ".upt-proj-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#0ea5e9,#60a5fa)}",
        ".upt-proj-val{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-text-secondary,#9ca3af);font-variant-numeric:tabular-nums}",
        ".upt-heatmap{display:flex;gap:3px;overflow-x:auto;padding-bottom:4px}",
        ".upt-week{display:flex;flex-direction:column;gap:3px;flex:0 0 auto}",
        ".upt-cell{width:12px;height:12px;border-radius:2px;background:rgba(148,163,184,.18)}",
        ".upt-lvl-1{background:#1d4ed8}",
        ".upt-lvl-2{background:#3b82f6}",
        ".upt-lvl-3{background:#60a5fa}",
        ".upt-lvl-4{background:#93c5fd}",
        ".upt-report{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--dsw-alias-text-secondary,#d1d5db);background:var(--dsw-alias-bg-elevated,#111827);border:1px solid var(--dsw-alias-border-subtle,#1f2937);border-radius:10px;padding:12px 14px}",
        ".upt-report b{color:var(--dsw-alias-text-primary,#f9fafb)}",
        ".upt-focus{background:var(--dsw-alias-bg-elevated,#111827);border:1px solid var(--dsw-alias-border-subtle,#1f2937);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}",
        ".upt-clock{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:1px;color:#93c5fd}",
        ".upt-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
        ".upt-btn{appearance:none;border:1px solid rgba(96,165,250,.45);background:var(--dsw-alias-accent,#2563eb);color:#fff;border-radius:8px;padding:8px 13px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}",
        ".upt-btn.ghost{background:rgba(148,163,184,.12);color:inherit;border-color:var(--dsw-alias-border-subtle,#374151);font-weight:500}",
        ".upt-btn.danger{background:rgba(248,113,113,.16);border-color:rgba(248,113,113,.5);color:#fca5a5}",
        ".upt-btn:hover:not([disabled]){filter:brightness(1.08)}",
        ".upt-btn[disabled]{opacity:.6;cursor:default}",
        ".upt-share{display:flex;flex-direction:column;gap:8px}",
        ".upt-share-img{width:100%;max-width:420px;border-radius:12px;border:1px solid var(--dsw-alias-border-subtle,#374151);display:block}",
        ".upt-hint{font-size:12px;color:var(--dsw-alias-text-secondary,#9ca3af);line-height:1.5}",
        ".upt-path{font-size:11px;color:#93c5fd;word-break:break-all;font-family:ui-monospace,Consolas,monospace;background:rgba(148,163,184,.08);border-radius:6px;padding:6px 8px}",
        ".upt-textarea{width:100%;min-height:86px;box-sizing:border-box;background:rgba(148,163,184,.08);color:inherit;border:1px solid var(--dsw-alias-border-subtle,#374151);border-radius:8px;padding:8px;font-family:ui-monospace,Consolas,monospace;font-size:11px;resize:vertical}",
        ".upt-note{font-size:11px;color:var(--dsw-alias-text-secondary,#9ca3af);line-height:1.6}",
        ".upt-loading,.upt-error{color:var(--dsw-alias-text-secondary,#9ca3af);font-size:13px;padding:16px}",
        ".upt-ok{font-size:12px;color:#34d399}"
      ].join("\n");

      let styleTag;

      function injectCss() {
        if (typeof document === "undefined") return () => {};
        if (styleTag === void 0) {
          const tag = document.createElement("style");
          tag.dataset.dshUsageTimeCss = "1";
          tag.textContent = CSS;
          document.head.appendChild(tag);
          styleTag = tag;
        }
        let released = false;
        return () => {
          if (released) return;
          released = true;
          if (styleTag !== void 0) {
            styleTag.remove();
            styleTag = void 0;
          }
        };
      }

      function fmtDuration(sec) {
        const s = Math.max(0, Math.floor(sec || 0));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (h > 0) return h + " 小时 " + m + " 分";
        if (m > 0) return m + " 分 " + (s % 60) + " 秒";
        return s + " 秒";
      }

      function fmtShort(sec) {
        const s = Math.max(0, Math.floor(sec || 0));
        if (s >= 3600) return (s / 3600).toFixed(1) + " 小时";
        if (s >= 60) return Math.max(1, Math.round(s / 60)) + " 分钟";
        return Math.max(0, s) + " 秒";
      }

      function fmtClock(sec) {
        const s = Math.max(0, Math.floor(sec || 0));
        const m = Math.floor(s / 60);
        const ss = s % 60;
        return String(m).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
      }

      function levelOf(sec) {
        if (sec <= 0) return 0;
        if (sec < 1800) return 1;
        if (sec < 3600) return 2;
        if (sec < 10800) return 3;
        return 4;
      }

      // days: 最旧 → 最新。按"每周一列、周日在上"拼成 GitHub 式热力图。
      function buildWeeks(days) {
        if (!days || !days.length) return [];
        const weeks = [];
        let col = [];
        const first = new Date(days[0].date + "T00:00:00");
        for (let i = 0; i < first.getDay(); i++) col.push(null);
        for (const d of days) {
          col.push(d);
          if (col.length === 7) {
            weeks.push(col);
            col = [];
          }
        }
        if (col.length) {
          while (col.length < 7) col.push(null);
          weeks.push(col);
        }
        return weeks;
      }

      // ---------- 分享卡片：主题化绘制 ----------

      const FONT = "'Microsoft YaHei','PingFang SC',system-ui,-apple-system,'Segoe UI',sans-serif";

      const CARD_THEMES = {
        midnight: {
          name: "深蓝",
          stops: ["#0b1220", "#111c2e", "#1b2a44"],
          glow: "rgba(59,130,246,0.30)",
          title: "rgba(148,163,184,0.95)",
          main: "#f8fafc",
          unit: "#93c5fd",
          sub: "rgba(148,163,184,0.9)",
          panelFill: "rgba(148,163,184,0.10)",
          panelLine: "rgba(148,163,184,0.18)",
          label: "rgba(148,163,184,0.85)",
          value: "#e2e8f0",
          section: "rgba(203,213,225,0.95)",
          line: "rgba(226,232,240,0.92)",
          foot: "rgba(148,163,184,0.75)",
          levels: ["rgba(148,163,184,0.16)", "#1d4ed8", "#3b82f6", "#60a5fa", "#93c5fd"]
        },
        ember: {
          name: "暖橙",
          stops: ["#1a0f0a", "#2a160d", "#3b1f10"],
          glow: "rgba(251,146,60,0.30)",
          title: "rgba(253,186,116,0.9)",
          main: "#fff7ed",
          unit: "#fdba74",
          sub: "rgba(253,186,116,0.85)",
          panelFill: "rgba(253,186,116,0.10)",
          panelLine: "rgba(253,186,116,0.20)",
          label: "rgba(253,186,116,0.85)",
          value: "#ffedd5",
          section: "rgba(254,215,170,0.95)",
          line: "rgba(255,237,213,0.92)",
          foot: "rgba(253,186,116,0.7)",
          levels: ["rgba(253,186,116,0.16)", "#c2410c", "#ea580c", "#f97316", "#fdba74"]
        },
        mint: {
          name: "薄荷",
          stops: ["#04120f", "#07211b", "#0b2f27"],
          glow: "rgba(52,211,153,0.28)",
          title: "rgba(110,231,183,0.9)",
          main: "#ecfdf5",
          unit: "#6ee7b7",
          sub: "rgba(110,231,183,0.85)",
          panelFill: "rgba(110,231,183,0.10)",
          panelLine: "rgba(110,231,183,0.20)",
          label: "rgba(110,231,183,0.85)",
          value: "#d1fae5",
          section: "rgba(167,243,208,0.95)",
          line: "rgba(209,250,229,0.92)",
          foot: "rgba(110,231,183,0.7)",
          levels: ["rgba(110,231,183,0.16)", "#047857", "#059669", "#10b981", "#6ee7b7"]
        },
        paper: {
          name: "极简白",
          stops: ["#f8fafc", "#eef2f7", "#e2e8f0"],
          glow: "rgba(59,130,246,0.18)",
          title: "rgba(71,85,105,0.9)",
          main: "#0f172a",
          unit: "#2563eb",
          sub: "rgba(71,85,105,0.9)",
          panelFill: "rgba(15,23,42,0.05)",
          panelLine: "rgba(15,23,42,0.10)",
          label: "rgba(71,85,105,0.9)",
          value: "#0f172a",
          section: "rgba(30,41,59,0.95)",
          line: "rgba(15,23,42,0.88)",
          foot: "rgba(71,85,105,0.75)",
          levels: ["rgba(15,23,42,0.08)", "#1d4ed8", "#3b82f6", "#60a5fa", "#bfdbfe"]
        }
      };

      const THEME_IDS = ["midnight", "ember", "mint", "paper"];

      function roundRect(ctx, x, y, w, hh, r) {
        const radius = Math.min(r, w / 2, hh / 2);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + hh - radius);
        ctx.quadraticCurveTo(x + w, y + hh, x + w - radius, y + hh);
        ctx.lineTo(x + radius, y + hh);
        ctx.quadraticCurveTo(x, y + hh, x, y + hh - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
      }

      function spaced(ctx, text, px) {
        try {
          ctx.letterSpacing = px + "px";
        } catch {
          /* 老 Chromium 不支持 letterSpacing，忽略 */
        }
        return text;
      }

      // 宿主可能还是旧版本（改了宿主代码需要重启 DSH），这里给缺省值兜底，
      // 保证面板在宿主升级前不会因为缺字段直接崩掉。
      function normalizeStats(raw) {
        const zeros24 = () => new Array(24).fill(0);
        const zeros7 = () => new Array(7).fill(0);
        return Object.assign({}, raw, {
          compare: raw.compare || { today: { pct: null }, week: { pct: null }, month: { pct: null } },
          hours: raw.hours || { total: zeros24(), today: zeros24(), weekday: zeros7() },
          hoursDays: typeof raw.hoursDays === "number" ? raw.hoursDays : 0,
          profile: raw.profile || null,
          peakHour: typeof raw.peakHour === "number" ? raw.peakHour : null,
          peakSeconds: typeof raw.peakSeconds === "number" ? raw.peakSeconds : 0,
          activeDays: typeof raw.activeDays === "number" ? raw.activeDays : 0,
          averagePerActiveDay: typeof raw.averagePerActiveDay === "number" ? raw.averagePerActiveDay : 0,
          longestStreak: typeof raw.longestStreak === "number" ? raw.longestStreak : 0,
          goal: raw.goal || { dailySeconds: 0, todayPct: 0, remaining: 0, met: false },
          focus: raw.focus || { today: { seconds: 0, sessions: 0 }, total: { seconds: 0, sessions: 0 } },
          badges: Array.isArray(raw.badges) ? raw.badges : [],
          projects: raw.projects && Array.isArray(raw.projects.today) ? raw.projects : { today: [], total: [], todayTracked: 0, days: 0 },
          session: raw.session && typeof raw.session.minutes === "number" ? raw.session : { minutes: 0, startAt: null, active: false },
          reminders: Array.isArray(raw.reminders) ? raw.reminders : [],
          shareCount: typeof raw.shareCount === "number" ? raw.shareCount : 0
        });
      }

      function badgeProgressText(badge) {
        if (badge.earned) return "已达成";
        if (badge.unit === "time") return fmtShort(badge.cur) + " / " + fmtShort(badge.target);
        if (badge.unit === "days") return badge.cur + " / " + badge.target + " 天";
        return badge.cur + " / " + badge.target;
      }

      // 生成分享卡片：tall = 540x760（1080x1520），square = 540x540（1080x1080）。
      function drawShareCard(stats, themeId, shape) {
        if (typeof document === "undefined") return null;
        const pal = CARD_THEMES[themeId] || CARD_THEMES.midnight;
        const square = shape === "square";
        const W = 540;
        const H = square ? 540 : 760;
        const S = 2;
        const canvas = document.createElement("canvas");
        canvas.width = W * S;
        canvas.height = H * S;
        const ctx = canvas.getContext("2d");
        if (ctx === null) return null;
        ctx.scale(S, S);

        const pad = 40;

        const drawBackdrop = () => {
          const bg = ctx.createLinearGradient(0, 0, W, H);
          bg.addColorStop(0, pal.stops[0]);
          bg.addColorStop(0.55, pal.stops[1]);
          bg.addColorStop(1, pal.stops[2]);
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, W, H);
          const glow = ctx.createRadialGradient(W * 0.82, 10, 0, W * 0.82, 10, 320);
          glow.addColorStop(0, pal.glow);
          glow.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = glow;
          ctx.fillRect(0, 0, W, Math.min(H, 420));
        };

        const drawHeader = (y) => {
          ctx.fillStyle = pal.title;
          ctx.font = "600 12px " + FONT;
          ctx.fillText(spaced(ctx, "DEEPSEEK HARNESS · 时间账本报告", 2), pad, y);
          ctx.letterSpacing = "0px";
          return y + (square ? 34 : 46);
        };

        const drawMain = (y) => {
          const totalText = stats.total >= 3600 ? (stats.total / 3600).toFixed(1) : String(Math.round(stats.total / 60));
          const unit = stats.total >= 3600 ? " 小时" : " 分钟";
          ctx.fillStyle = pal.main;
          ctx.font = "800 " + (square ? 44 : 56) + "px " + FONT;
          ctx.fillText(String(totalText), pad, y);
          const totalWidth = ctx.measureText(String(totalText)).width;
          ctx.fillStyle = pal.unit;
          ctx.font = "700 " + (square ? 20 : 24) + "px " + FONT;
          ctx.fillText(unit, pad + totalWidth + 8, y);
          return y + (square ? 22 : 30);
        };

        const drawSub = (y) => {
          ctx.fillStyle = pal.sub;
          ctx.font = "500 13px " + FONT;
          ctx.fillText("累计在 DeepSeek Harness 中投入的时间", pad, y);
          return y + (square ? 26 : 44);
        };

        const drawMetrics = (y) => {
          const cells = [
            ["连续使用", stats.streak + " 天"],
            ["最勤奋的一天", stats.bestDay === null ? "—" : stats.bestDay.slice(5)],
            ["记录天数", stats.days.filter((d) => d.seconds > 0).length + " 天"]
          ];
          const gap = square ? 10 : 12;
          const boxW = (W - pad * 2 - gap * 2) / 3;
          const boxH = square ? 66 : 84;
          cells.forEach((cell, i) => {
            const x = pad + i * (boxW + gap);
            ctx.fillStyle = pal.panelFill;
            roundRect(ctx, x, y, boxW, boxH, 12);
            ctx.fill();
            ctx.strokeStyle = pal.panelLine;
            ctx.lineWidth = 1;
            roundRect(ctx, x, y, boxW, boxH, 12);
            ctx.stroke();

            ctx.fillStyle = pal.label;
            ctx.font = "500 " + (square ? 11 : 12) + "px " + FONT;
            ctx.fillText(cell[0], x + 12, y + (square ? 22 : 28));

            ctx.fillStyle = pal.value;
            ctx.font = "700 " + (square ? 17 : 20) + "px " + FONT;
            ctx.fillText(cell[1], x + 12, y + (square ? 48 : 58));
          });
          return y + boxH + (square ? 22 : 44);
        };

        const drawMiniHeat = (y) => {
          ctx.fillStyle = pal.section;
          ctx.font = "600 13px " + FONT;
          ctx.fillText("最近 26 周", pad, y);
          y += 18;
          const span = 182;
          const recent = stats.days.slice(-span);
          const cellSize = 11;
          const cellGap = 4;
          const gridTop = y;
          let col = 0;
          recent.forEach((day, idx) => {
            const weekday = new Date(day.date + "T00:00:00").getDay();
            if (idx > 0 && weekday === 0) col += 1;
            const x = pad + col * (cellSize + cellGap);
            const yy = gridTop + weekday * (cellSize + cellGap);
            ctx.fillStyle = pal.levels[levelOf(day.seconds)];
            roundRect(ctx, x, yy, cellSize, cellSize, 3);
            ctx.fill();
          });
          return gridTop + 7 * (cellSize + cellGap) + 30;
        };

        const drawBadgeChips = (y) => {
          const earned = stats.badges.filter((b) => b.earned).slice(0, 4);
          if (earned.length === 0) return y;
          ctx.fillStyle = pal.section;
          ctx.font = "600 13px " + FONT;
          ctx.fillText("已解锁成就", pad, y);
          y += 24;
          const gap = 8;
          const boxW = (W - pad * 2 - gap * 3) / 4;
          earned.forEach((b, i) => {
            const x = pad + i * (boxW + gap);
            ctx.fillStyle = pal.panelFill;
            roundRect(ctx, x, y, boxW, 54, 10);
            ctx.fill();
            ctx.strokeStyle = pal.panelLine;
            ctx.lineWidth = 1;
            roundRect(ctx, x, y, boxW, 54, 10);
            ctx.stroke();
            ctx.fillStyle = pal.value;
            ctx.font = "500 18px " + FONT;
            ctx.fillText(b.icon, x + 10, y + 24);
            ctx.fillStyle = pal.label;
            ctx.font = "500 10px " + FONT;
            ctx.fillText(b.name.slice(0, 6), x + 10, y + 42);
          });
          return y + 54 + 24;
        };

        const drawSummary = (y) => {
          ctx.fillStyle = pal.section;
          ctx.font = "600 13px " + FONT;
          ctx.fillText("年度小结", pad, y);
          y += 26;
          ctx.font = "500 13px " + FONT;
          const lines = [
            "本年累计 " + fmtShort(stats.year),
            stats.bestDay === null ? "还没有足够的数据" : "最勤奋的一天 " + stats.bestDay + "（" + fmtShort(stats.bestSeconds) + "）",
            stats.firstDay === null ? "" : "记录始于 " + stats.firstDay
          ].filter((s) => s !== "");
          for (const line of lines) {
            ctx.fillStyle = pal.line;
            ctx.fillText("· " + line, pad, y);
            y += 24;
          }
          return y;
        };

        const drawFooter = () => {
          const today = new Date();
          const dateText = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
          ctx.fillStyle = pal.foot;
          ctx.font = "500 11px " + FONT;
          ctx.fillText(dateText + " · dsh-timekeeper", pad, H - 32);
          ctx.textAlign = "right";
          ctx.fillText("自动统计，无需手动操作", W - pad, H - 32);
          ctx.textAlign = "left";
        };

        drawBackdrop();
        let y = square ? 56 : 64;
        y = drawHeader(y);
        y = drawMain(y);
        y = drawSub(y);
        y = drawMetrics(y);
        if (square) {
          y = drawBadgeChips(y);
        } else {
          y = drawMiniHeat(y);
          y = drawSummary(y);
          y = drawBadgeChips(y);
        }
        drawFooter();

        try {
          return canvas.toDataURL("image/png");
        } catch {
          return null;
        }
      }

      function UsagePanel() {
        const [stats, setStats] = useState(null);
        const [error, setError] = useState(null);
        const [tick, setTick] = useState(0);

        // 分享卡片
        const [card, setCard] = useState(null);
        const [cardBusy, setCardBusy] = useState(false);
        const [cardErr, setCardErr] = useState(null);
        const [theme, setTheme] = useState("midnight");
        const [shape, setShape] = useState("tall");

        // 每日目标
        const [goalDraft, setGoalDraft] = useState("");
        const [goalMsg, setGoalMsg] = useState(null);

        // 番茄钟
        const [pomoTotal, setPomoTotal] = useState(1500);
        const [pomoLeft, setPomoLeft] = useState(0);
        const [pomoRunning, setPomoRunning] = useState(false);
        const [pomoMsg, setPomoMsg] = useState(null);
        const pomoSubmitted = useRef(false);

        // 数据管理
        const [exportJson, setExportJson] = useState(null);
        const [importText, setImportText] = useState("");
        const [dataMsg, setDataMsg] = useState(null);
        const [dataBusy, setDataBusy] = useState(false);
        const [resetArmed, setResetArmed] = useState(false);

        const heatRef = useRef(null);

        const refresh = () => setTick((v) => v + 1);

        useEffect(() => {
          diag("panel: 已挂载");
          let alive = true;
          const load = async () => {
            try {
              const res = await fetch(ROUTE_PATH + "/stats", { cache: "no-store" });
              if (!res.ok) throw new Error("HTTP " + res.status);
              const data = normalizeStats(await res.json());
              if (alive) {
                diag("panel: 取数成功 total=" + data.total);
                setStats(data);
                setError(null);
              }
            } catch (e) {
              diag("panel: 取数失败 " + (e instanceof Error ? e.message : String(e)));
              if (alive) setError(e instanceof Error ? e.message : String(e));
            }
          };
          load();
          const t = setInterval(load, 30000);
          return () => {
            alive = false;
            clearInterval(t);
          };
        }, [tick]);

        // 目标输入框初次同步
        useEffect(() => {
          if (stats !== null && goalDraft === "") setGoalDraft(String(Math.round(stats.goal.dailySeconds / 360) / 10));
        }, [stats, goalDraft]);

        // 热力图默认滚到最右侧
        useEffect(() => {
          const el = heatRef.current;
          if (el !== null && stats !== null) el.scrollLeft = el.scrollWidth;
        }, [stats]);

        // 番茄钟滴答
        useEffect(() => {
          if (!pomoRunning) return;
          const id = setInterval(() => setPomoLeft((v) => (v > 0 ? v - 1 : 0)), 1000);
          return () => clearInterval(id);
        }, [pomoRunning]);

        useEffect(() => {
          if (!pomoRunning || pomoLeft > 0) return;
          setPomoRunning(false);
          if (pomoSubmitted.current) return;
          pomoSubmitted.current = true;
          const seconds = pomoTotal;
          fetch(ROUTE_PATH + "/focus", {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({ seconds, sessions: 1 })
          }).then(async (res) => {
            const payload = await res.json().catch(() => null);
            if (res.ok && payload !== null && payload.ok === true) {
              diag("focus: 完成 " + seconds + " 秒");
              setPomoMsg("完成一个 " + Math.round(seconds / 60) + " 分钟专注 🎉");
              refresh();
            } else {
              setPomoMsg("专注完成，但上报失败（" + res.status + "）");
            }
          }).catch((e) => setPomoMsg("专注完成，但上报异常：" + (e instanceof Error ? e.message : String(e))));
        }, [pomoLeft, pomoRunning, pomoTotal]);

        const startPomo = () => {
          pomoSubmitted.current = false;
          setPomoMsg(null);
          setPomoLeft(pomoTotal);
          setPomoRunning(true);
        };
        const abandonPomo = () => {
          pomoSubmitted.current = true;
          setPomoRunning(false);
          setPomoLeft(0);
          setPomoMsg("已放弃本次专注，不记录时长");
        };

        const saveGoal = async () => {
          const hours = Number(goalDraft);
          if (!Number.isFinite(hours) || hours < 0 || hours > 16) {
            setGoalMsg("小时数需在 0 ~ 16 之间");
            return;
          }
          setGoalMsg(null);
          try {
            const res = await fetch(ROUTE_PATH + "/goal", {
              method: "POST",
              headers: { "Content-Type": "text/plain" },
              body: JSON.stringify({ dailySeconds: Math.round(hours * 3600) })
            });
            if (!res.ok) throw new Error("HTTP " + res.status);
            setGoalMsg("目标已保存");
            refresh();
          } catch (e) {
            setGoalMsg("保存失败：" + (e instanceof Error ? e.message : String(e)));
          }
        };

        const generateCard = async () => {
          if (stats === null || cardBusy) return;
          setCardBusy(true);
          setCardErr(null);
          try {
            const dataUrl = drawShareCard(stats, theme, shape);
            if (dataUrl === null) throw new Error("canvas 导出失败");
            diag("share: 卡片已生成 约 " + Math.round((dataUrl.length * 3) / 4 / 1024) + "KB theme=" + theme + " shape=" + shape);
            const next = { dataUrl, path: "", mode: "preview" };

            try {
              const res = await fetch(ROUTE_PATH + "/share", {
                method: "POST",
                headers: { "Content-Type": "text/plain" },
                body: JSON.stringify({ dataUrl })
              });
              const payload = await res.json().catch(() => null);
              if (res.ok && payload !== null && payload.ok === true) {
                next.path = String(payload.path);
                next.mode = "saved";
                diag("share: 已保存 " + next.path + "（" + payload.bytes + "B）");
              } else {
                diag("share: 宿主保存失败 status=" + res.status + " " + String(payload && payload.error));
              }
            } catch (e) {
              diag("share: 宿主保存异常 " + (e instanceof Error ? e.message : String(e)));
            }

            if (next.mode !== "saved") {
              try {
                const blob = await (await fetch(dataUrl)).blob();
                if (typeof ClipboardItem !== "undefined" && navigator.clipboard !== void 0 && typeof navigator.clipboard.write === "function") {
                  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
                  next.mode = "clipboard";
                  diag("share: 已复制到剪贴板");
                }
              } catch (e) {
                diag("share: 剪贴板失败 " + (e instanceof Error ? e.message : String(e)));
              }
            }

            if (next.mode === "preview") {
              try {
                const a = document.createElement("a");
                a.href = dataUrl;
                a.download = "dsh-timekeeper-" + Date.now() + ".png";
                document.body.appendChild(a);
                a.click();
                a.remove();
                diag("share: 已触发浏览器下载");
              } catch (e) {
                diag("share: 下载触发失败 " + (e instanceof Error ? e.message : String(e)));
              }
            }

            setCard(next);
            refresh();
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            diag("share: 生成失败 " + message);
            setCardErr(message);
          } finally {
            setCardBusy(false);
          }
        };

        const exportData = async () => {
          setDataBusy(true);
          setDataMsg(null);
          try {
            const res = await fetch(ROUTE_PATH + "/export", { cache: "no-store" });
            if (!res.ok) throw new Error("HTTP " + res.status);
            const payload = await res.json();
            const text = JSON.stringify(payload.state, null, 2);
            setExportJson(text);
            try {
              const blob = new Blob([text], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "dsh-timekeeper-backup.json";
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 5000);
            } catch { /* 下载失败不影响文本展示 */ }
            setDataMsg("已导出，可复制下方 JSON 备份");
          } catch (e) {
            setDataMsg("导出失败：" + (e instanceof Error ? e.message : String(e)));
          } finally {
            setDataBusy(false);
          }
        };

        const importData = async () => {
          if (importText.trim() === "") {
            setDataMsg("请先粘贴备份 JSON");
            return;
          }
          let payload;
          try {
            payload = JSON.parse(importText);
          } catch {
            setDataMsg("JSON 解析失败，请检查内容");
            return;
          }
          setDataBusy(true);
          setDataMsg(null);
          try {
            const res = await fetch(ROUTE_PATH + "/import", {
              method: "POST",
              headers: { "Content-Type": "text/plain" },
              body: JSON.stringify({ state: payload.state || payload })
            });
            const body = await res.json().catch(() => null);
            if (!res.ok) throw new Error((body && body.error) || "HTTP " + res.status);
            setDataMsg("导入成功：" + body.days + " 天记录" + (body.hours ? "，" + body.hours + " 天含小时分布" : ""));
            setImportText("");
            refresh();
          } catch (e) {
            setDataMsg("导入失败：" + (e instanceof Error ? e.message : String(e)));
          } finally {
            setDataBusy(false);
          }
        };

        const resetData = async () => {
          if (!resetArmed) {
            setResetArmed(true);
            setDataMsg("再点一次「确认清空」会删除全部统计数据，不可恢复");
            return;
          }
          setResetArmed(false);
          setDataBusy(true);
          try {
            const res = await fetch(ROUTE_PATH + "/reset", {
              method: "POST",
              headers: { "Content-Type": "text/plain" },
              body: JSON.stringify({ confirm: true })
            });
            if (!res.ok) throw new Error("HTTP " + res.status);
            setDataMsg("已清空全部统计数据");
            setExportJson(null);
            setCard(null);
            refresh();
          } catch (e) {
            setDataMsg("清空失败：" + (e instanceof Error ? e.message : String(e)));
          } finally {
            setDataBusy(false);
          }
        };

        if (error) return h("div", { className: "upt-error", children: "加载失败：" + error + "（宿主路由 " + ROUTE_PATH + "/stats）" });
        if (!stats) return h("div", { className: "upt-loading", children: "加载中…" });

        // ---- 卡片（带环比） ----
        const deltaOf = (cmp) => {
          if (cmp === void 0 || cmp.pct === null) return null;
          if (cmp.pct > 0) return h("span", { className: "upt-delta up", children: "▲" + cmp.pct + "%" });
          if (cmp.pct < 0) return h("span", { className: "upt-delta down", children: "▼" + Math.abs(cmp.pct) + "%" });
          return h("span", { className: "upt-delta flat", children: "持平" });
        };
        const cards = [
          ["今日", stats.today, stats.compare.today],
          ["本周", stats.week, stats.compare.week],
          ["本月", stats.month, stats.compare.month],
          ["累计", stats.total, null]
        ];
        const cardNodes = cards.map((c) => h("div", { className: "upt-card", key: c[0], children: [
          h("div", { className: "upt-card-label", children: c[0] }),
          h("div", { className: "upt-card-value", children: [
            fmtDuration(c[1]),
            c[2] === null ? null : deltaOf(c[2])
          ] })
        ] }));

        // ---- 目标 ----
        const goalBlock = h("div", { className: "upt-goal", children: [
          h("div", { className: "upt-goal-top", children: [
            h("span", { children: "今日目标 " + (stats.goal.dailySeconds > 0 ? fmtShort(stats.goal.dailySeconds) : "未设置") }),
            h("span", { children: stats.goal.met ? "已达成 🎉" : stats.goal.todayPct + "%" })
          ] }),
          h("div", { className: "upt-bar", children: h("div", {
            className: "upt-bar-fill" + (stats.goal.met ? " met" : ""),
            style: { width: Math.max(2, stats.goal.todayPct) + "%" }
          }) }),
          h("div", { className: "upt-row", children: [
            h("span", { className: "upt-hint", children: stats.goal.met ? "保持节奏，记得起来活动一下" : "还差 " + fmtShort(stats.goal.remaining) }),
            h("input", {
              className: "upt-input",
              type: "number",
              min: 0,
              max: 16,
              step: 0.5,
              value: goalDraft,
              onChange: (e) => setGoalDraft(e.target.value)
            }),
            h("span", { className: "upt-hint", children: "小时" }),
            h("button", { className: "upt-btn ghost", onClick: saveGoal, children: "保存目标" })
          ] }),
          goalMsg === null ? null : h("div", { className: "upt-hint", children: goalMsg })
        ] });

        // ---- 时段洞察 ----
        const hourTotal = stats.hours.total;
        const maxHour = Math.max.apply(null, hourTotal.concat([1]));
        const hourBars = hourTotal.map((v, i) => h("div", { className: "upt-bar-col", key: i, title: i + ":00 " + fmtDuration(v), children: h("div", {
          className: "upt-bar-seg" + (stats.peakHour === i ? " peak" : ""),
          style: { height: Math.round((v / maxHour) * 100) + "%" }
        }) }));
        const hourAxis = [];
        for (let i = 0; i < 24; i += 6) hourAxis.push(h("span", { key: i, children: String(i) }));
        const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
        const weekdayNames = ["一", "二", "三", "四", "五", "六", "日"];
        const weekdayVals = weekdayOrder.map((d) => stats.hours.weekday[d] || 0);
        const maxWeekday = Math.max.apply(null, weekdayVals.concat([1]));
        const weekdayBars = weekdayVals.map((v, i) => h("div", { className: "upt-bar-col", key: i, title: "周" + weekdayNames[i] + " " + fmtDuration(v), children: h("div", {
          className: "upt-bar-seg",
          style: { height: Math.round((v / maxWeekday) * 100) + "%" }
        }) }));
        const weekdayAxis = weekdayNames.map((n, i) => h("span", { key: i, children: n }));

        const hoursBlock = h("div", { children: [
          h("div", { className: "upt-section-title", children: "时段洞察 · 24 小时分布" }),
          stats.hoursDays > 0
            ? h("div", { className: "upt-bars", children: hourBars })
            : h("div", { className: "upt-hint", children: "从 v0.3 起开始记录小时分布，用几小时后这里就会有数据" }),
          stats.hoursDays > 0 ? h("div", { className: "upt-axis", children: hourAxis }) : null,
          stats.peakHour === null ? null : h("div", { className: "upt-hint", children: "高峰时段：" + stats.peakHour + ":00 前后，累计 " + fmtDuration(stats.peakSeconds) + (stats.profile ? "；画像：" + stats.profile.label + "（占 " + stats.profile.share + "%）" : "") }),
          h("div", { className: "upt-section-title", children: "周内分布" }),
          h("div", { className: "upt-bars", children: weekdayBars }),
          h("div", { className: "upt-axis", children: weekdayAxis })
        ] });

        // ---- 项目归属 ----
        const projToday = stats.projects.today;
        const projTotal = stats.projects.total;
        const projRow = (item, key) => h("div", { className: "upt-proj-row", key, title: item.name + "：" + fmtDuration(item.seconds) + "（" + item.pct + "%）", children: [
          h("div", { className: "upt-proj-name", children: item.name }),
          h("div", { className: "upt-proj-track", children: h("div", { className: "upt-proj-fill", style: { width: Math.max(2, Math.min(100, item.pct)) + "%" } }) }),
          h("div", { className: "upt-proj-val", children: fmtDuration(item.seconds) + " · " + item.pct + "%" })
        ] });
        const projectsBlock = h("div", { children: [
          h("div", { className: "upt-section-title", children: "项目归属 · 今日" }),
          projToday.length > 0
            ? h("div", { className: "upt-proj", children: projToday.map((item, i) => projRow(item, "t" + i)) })
            : h("div", { className: "upt-hint", children: "在某个工作区里发消息后，这里会显示今天的时间花在哪个项目上" }),
          projTotal.length > 0
            ? h("div", { children: [
              h("div", { className: "upt-section-title", children: "累计占比" }),
              h("div", { className: "upt-proj", children: projTotal.map((item, i) => projRow(item, "a" + i)) })
            ] })
            : null
        ] });

        // ---- 成就徽章 ----
        const badgeNodes = stats.badges.map((b) => h("div", {
          className: "upt-badge" + (b.earned ? " earned" : " locked"),
          key: b.id,
          title: b.desc,
          children: [
            h("div", { className: "upt-badge-icon", children: b.icon }),
            h("div", { className: "upt-badge-name", children: b.name }),
            h("div", { className: "upt-badge-prog", children: badgeProgressText(b) })
          ]
        }));
        const earnedCount = stats.badges.filter((b) => b.earned).length;
        const badgeBlock = h("div", { children: [
          h("div", { className: "upt-section-title", children: "成就徽章 · 已解锁 " + earnedCount + "/" + stats.badges.length }),
          h("div", { className: "upt-badges", children: badgeNodes })
        ] });

        // ---- 热力图 ----
        const weeks = buildWeeks(stats.days);
        const weekNodes = weeks.map((col, i) => h("div", { className: "upt-week", key: i, children: col.map((cell, j) => {
          if (cell === null) return h("div", { className: "upt-cell", key: j });
          const lvl = levelOf(cell.seconds);
          return h("div", {
            className: "upt-cell upt-lvl-" + lvl,
            key: j,
            title: cell.date + " " + fmtDuration(cell.seconds)
          });
        }) }));
        const heatBlock = h("div", { children: [
          h("div", { className: "upt-section-title", children: "过去一年 · 日历热力图" }),
          h("div", { className: "upt-heatmap", ref: heatRef, children: weekNodes })
        ] });

        // ---- 年度小结 ----
        const reportNodes = [
          h("div", { key: "year", children: ["本年累计：", h("b", { children: fmtDuration(stats.year) })] }),
          h("div", { key: "avg", children: ["平均每天（有记录的天）：", h("b", { children: fmtDuration(stats.averagePerActiveDay) })] }),
          h("div", { key: "longest", children: ["最长连续：", h("b", { children: stats.longestStreak + " 天" })] }),
          stats.bestDay ? h("div", { key: "best", children: ["最勤奋的一天：", h("b", { children: stats.bestDay + "（" + fmtDuration(stats.bestSeconds) + "）" })] }) : null,
          stats.firstDay ? h("div", { key: "first", children: ["记录始于：", h("b", { children: stats.firstDay })] }) : null
        ];
        const reportBlock = h("div", { children: [
          h("div", { className: "upt-section-title", children: "年度小结" }),
          h("div", { className: "upt-report", children: reportNodes })
        ] });

        // ---- 番茄钟 ----
        const pomoBlock = h("div", { children: [
          h("div", { className: "upt-section-title", children: "专注 · 番茄钟" }),
          h("div", { className: "upt-focus", children: [
            h("div", { className: "upt-clock", children: fmtClock(pomoRunning ? pomoLeft : pomoTotal) }),
            h("div", { className: "upt-row", children: [
              h("select", {
                className: "upt-select",
                value: String(pomoTotal / 60),
                disabled: pomoRunning,
                onChange: (e) => setPomoTotal(Math.round(Number(e.target.value) * 60)),
                children: [25, 45, 60].map((m) => h("option", { key: m, value: String(m), children: m + " 分钟" }))
              }),
              h("button", { className: "upt-btn", onClick: startPomo, disabled: pomoRunning, children: pomoRunning ? "专注中…" : "开始专注" }),
              h("button", { className: "upt-btn ghost", onClick: abandonPomo, disabled: !pomoRunning, children: "放弃" })
            ] }),
            h("div", { className: "upt-hint", children: "今日已专注 " + stats.focus.today.sessions + " 次 · " + fmtDuration(stats.focus.today.seconds) }),
            pomoMsg === null ? null : h("div", { className: "upt-ok", children: pomoMsg })
          ] })
        ] });

        // ---- 分享 ----
        const cardStatus = card === null
          ? ""
          : card.mode === "saved"
            ? "已保存为 PNG 文件，可直接分享（也可右键图片另存）"
            : card.mode === "clipboard"
              ? "宿主保存不可用，已复制到剪贴板，直接粘贴即可分享"
              : "已生成预览，可右键图片另存";
        const cardBlock = card === null ? null : h("div", { className: "upt-share", children: [
          h("img", { className: "upt-share-img", src: card.dataUrl, alt: "时间账本分享卡片" }),
          h("div", { className: "upt-hint", children: cardStatus }),
          card.path !== "" ? h("div", { className: "upt-path", title: card.path, children: card.path }) : null
        ] });
        const shareBlock = h("div", { children: [
          h("div", { className: "upt-section-title", children: "分享" }),
          h("div", { className: "upt-actions", children: [
            h("select", {
              className: "upt-select",
              value: theme,
              onChange: (e) => setTheme(e.target.value),
              children: THEME_IDS.map((id) => h("option", { key: id, value: id, children: CARD_THEMES[id].name }))
            }),
            h("select", {
              className: "upt-select",
              value: shape,
              onChange: (e) => setShape(e.target.value),
              children: [
                h("option", { key: "tall", value: "tall", children: "竖版 9:16" }),
                h("option", { key: "square", value: "square", children: "方形 1:1" })
              ]
            }),
            h("button", {
              className: "upt-btn",
              onClick: generateCard,
              disabled: cardBusy,
              children: cardBusy ? "生成中…" : card === null ? "生成分享卡片" : "重新生成"
            })
          ] }),
          cardErr !== null ? h("div", { className: "upt-error", children: "生成失败：" + cardErr }) : null,
          cardBlock
        ] });

        // ---- 数据管理 ----
        const dataBlock = h("div", { children: [
          h("div", { className: "upt-section-title", children: "数据管理" }),
          h("div", { className: "upt-actions", children: [
            h("button", { className: "upt-btn ghost", onClick: exportData, disabled: dataBusy, children: "导出 JSON" }),
            h("button", {
              className: "upt-btn ghost",
              onClick: importData,
              disabled: dataBusy,
              children: "导入备份"
            }),
            h("button", {
              className: "upt-btn danger",
              onClick: resetData,
              disabled: dataBusy,
              children: resetArmed ? "确认清空" : "清空数据"
            })
          ] }),
          h("textarea", {
            className: "upt-textarea",
            placeholder: "把备份 JSON 粘贴到这里，再点「导入备份」；点「导出 JSON」时这里会显示当前完整数据",
            value: importText === "" && exportJson !== null ? exportJson : importText,
            onChange: (e) => setImportText(e.target.value)
          }),
          dataMsg === null ? null : h("div", { className: "upt-hint", children: dataMsg }),
          h("div", { className: "upt-note", children: "隐私：所有数据只保存在本机 " + "<DSH_HOME>/dsh-timekeeper/usage.json，不会上传到任何服务器。" })
        ] });

        const tipsBlock = stats.reminders.length === 0 ? null : h("div", { className: "upt-tips", children:
          stats.reminders.map((r, i) => h("div", { key: r.kind + i, className: "upt-tip upt-tip-" + r.kind, children: r.text }))
        });

        return h("div", { className: "upt-panel", children: [
          h("div", { className: "upt-head", children: [
            h("div", { className: "upt-title", children: "DeepSeek 时间账本" }),
            stats.profile ? h("div", { className: "upt-chip", children: stats.profile.label }) : null
          ] }),
          h("div", { className: "upt-cards", children: cardNodes }),
          goalBlock,
          h("div", { className: "upt-streak", children: "连续使用 " + stats.streak + " 天" + (stats.streak > 0 ? "，继续保持！" : "，今天开始计时吧") }),
          tipsBlock,
          hoursBlock,
          projectsBlock,
          badgeBlock,
          heatBlock,
          reportBlock,
          pomoBlock,
          shareBlock,
          dataBlock
        ] });
      }

      const name = "timekeeper";
      // 只等待保证注册成功的最小服务：slots。
      // sidebarRightTabs / sidebarRight 用 ctx.inject 显式声明等待——
      // Cordis 的上下文代理禁止"没 inject 就取属性"（会抛
      // `cannot get property "sidebarRightTabs" without inject`），
      // 所以在 inject 作用域里取才是安全写法。
      const inject = ["slots"];

      function registerTabWith(ctx, tabs) {
        if (tabs === void 0 || typeof tabs.register !== "function") {
          diag("registerTab: sidebarRightTabs 不可用（" + typeof tabs + "）");
          return () => {};
        }
        let disposeType = () => {};
        try {
          disposeType = tabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            priority: "extension",
            title: () => "时间账本",
            guide: [{
              id: TAB_KIND,
              order: 400,
              title: () => "时间账本",
              description: () => "自动统计你在 DeepSeek Harness 中的时间投入与习惯洞察"
            }]
          });
          diag("registerTab: 类型注册成功");
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          // 热重载/旧版本残留时同 id 已经注册过：类型本身可用，继续补正文注册即可，
          // 否则会连正文都挂不上、标签页空白。
          if (message.includes("already registered")) {
            diag("registerTab: 类型已存在，跳过注册并继续正文");
          } else {
            diag("registerTab: 类型注册失败 " + message);
            return () => {};
          }
        }

        // 官方写法：回调直接返回注册 disposer（不要用 generator yield）。
        const disposeBody = ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
          name: "sidebar.right.pane.tab",
          key: TAB_ID,
          order: 100
        }, () => h(UsagePanel, {})));
        diag("registerTab: 正文注册成功");

        const disposeCss = injectCss();
        return () => {
          try {
            if (typeof disposeBody === "function") disposeBody();
          } catch { /* 忽略 */ }
          try {
            disposeType();
          } catch { /* 忽略 */ }
          disposeCss();
        };
      }

      function maybeAutoOpen(controller) {
        let opened = false;
        try {
          opened = typeof sessionStorage !== "undefined" && sessionStorage.getItem(AUTO_OPEN_FLAG) === "1";
        } catch {
          opened = false;
        }
        if (opened) {
          diag("autoOpen: 本会话已开过，跳过");
          return;
        }
        if (controller === void 0 || typeof controller.openTab !== "function") {
          diag("autoOpen: sidebarRight 不可用（" + typeof controller + "）");
          return;
        }
        try {
          controller.openTab(TAB_KIND);
          try {
            sessionStorage.setItem(AUTO_OPEN_FLAG, "1");
          } catch { /* 忽略 */ }
          diag("autoOpen: 已调用 openTab");
        } catch (e) {
          diag("autoOpen: 失败 " + (e instanceof Error ? e.message : String(e)));
        }
      }

      function apply(ctx) {
        diag("apply: 进入");

        ctx.effect(() => {
          try {
            return ctx.inject(["sidebarRightTabs"], (scope) => {
              try {
                return registerTabWith(ctx, scope.sidebarRightTabs);
              } catch (e) {
                diag("apply: 注册抛错 " + (e instanceof Error ? e.stack || e.message : String(e)).slice(0, 500));
                return () => {};
              }
            });
          } catch (e) {
            diag("apply: inject(sidebarRightTabs) 抛错 " + String(e));
            return () => {};
          }
        }, "dsh-timekeeper: 右侧栏标签页");

        // 等 sidebarRight 就绪后自动打开一次，让用户第一眼就能看到。
        ctx.effect(() => {
          try {
            return ctx.inject(["sidebarRight"], (scope) => {
              diag("apply: sidebarRight 就绪");
              const timer = setTimeout(() => maybeAutoOpen(scope.sidebarRight), 800);
              return () => clearTimeout(timer);
            });
          } catch (e) {
            diag("apply: inject(sidebarRight) 抛错 " + String(e));
            return () => {};
          }
        }, "dsh-timekeeper: 自动打开标签页");
      }

      const module = { exports: {} };
      module.exports = { apply, inject, name };
      return module.exports;
    };
  }

  diag("module: 加载 __ModuleLoader__=" + (typeof window !== "undefined" && window.__ModuleLoader__ ? "yes" : "no")
    + " baseURI=" + (typeof document !== "undefined" ? document.baseURI : "-")
    + " routePath=" + ROUTE_PATH);

  if (typeof window !== "undefined" && window.__ModuleLoader__) {
    window.__ModuleLoader__.load({ id: "dsh-timekeeper", factory: makeFactory() });
    diag("module: 已调用 __ModuleLoader__.load");
  } else {
    diag("module: __ModuleLoader__ 缺失，无法注册");
  }
})();
