// dsh-my-questions-outline — 客户端半部（classic-script CJS bundle）。
// 经 window.__ModuleLoader__.load 注册，随 DSH 启动图每次页面加载自动注入。
//
// 功能：
//   1. 通过 MutationObserver 识别当前会话中的「我」发的消息（data-chat-flow-kind="user"）
//      与插话（"steering"），按顺序收集成大纲。
//   2. 在页面右侧渲染一个可收起/展开的侧边栏「我的提问大纲」。
//   3. 本地持久化（localStorage，按会话隔离）：曾经加载/见到过的提问，即使后来被分页
//      顶出 DOM，也会保留在大纲里；切换会话、刷新页面都不残留旧会话数据。
//   4. 点击大纲条目 → 平滑滚动到对应消息并高亮约 2.5 秒；若目标不在 DOM（已被分页顶出），
//      自动循环点击「加载更早」直到其出现。

window.__ModuleLoader__.load({
  id: "dsh-my-questions-outline",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var h = React.createElement;

    // ---- 选择器 / 常量（集中管理，便于随 DSH 版本升级调整）----
    // 用户消息与插话消息在 DOM 上带稳定的语义标记：
    //   [data-chat-flow-kind="user"]     —— 我发送的文本提问
    //   [data-chat-flow-kind="steering"] —— 我中途打断/补充的插话
    var FLOW_KIND_SELECTOR = '[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]';
    var ANCHOR_ATTR = "data-chat-anchor-key";
    var STORAGE_PREFIX = "dsh-my-questions-outline:v1:";
    var STORAGE_INDEX = "dsh-my-questions-outline:index";
    var STORAGE_TOP = "dsh-my-questions-outline:top";
    var DEFAULT_TOP = 16;
    var STYLE_ID = "dsh-my-questions-outline-style";
    var HIGHLIGHT_CLASS = "dsh-qo-highlight";
    var MAX_ITEMS_PER_SESSION = 500;
    var MAX_TEXT_LENGTH = 1000;
    var MAX_SESSIONS = 20;
    var FALLBACK_LABEL = "（附件 / 无文字）";
    var HIGHLIGHT_MS = 2500;
    var RESCAN_DEBOUNCE_MS = 150;

    var CSS = [
      ".dsh-qo-root{position:fixed;right:12px;z-index:30;pointer-events:auto;font-family:inherit;touch-action:none}",
      ".dsh-qo-root,.dsh-qo-root *{box-sizing:border-box}",
      ".dsh-qo-strip{width:36px;min-height:72px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#e5e5e5;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:var(--dsw-shadow-lv2);color:var(--dsw-alias-label-secondary);cursor:grab;padding:12px 0;user-select:none}",
      ".dsh-qo-strip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dsh-qo-strip-label{writing-mode:vertical-rl;font-size:12px;line-height:16px;letter-spacing:2px}",
      ".dsh-qo-badge{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-solid,#fff);font-size:11px;line-height:18px;text-align:center;font-weight:600;font-variant-numeric:tabular-nums}",
      ".dsh-qo-panel{width:288px;max-height:min(60vh,520px);display:flex;flex-direction:column;background:#e5e5e5;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:var(--dsw-shadow-lv2);color:var(--dsw-alias-label-primary);overflow:hidden}",
      "body[data-ds-dark-theme] .dsh-qo-strip,body[data-ds-dark-theme] .dsh-qo-panel{background:var(--dsw-alias-bg-layer-1)}",
      ".dsh-qo-header{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:grab;user-select:none}",
      ".dsh-qo-title{font-size:14px;font-weight:600;line-height:20px;margin:0}",
      ".dsh-qo-collapse{width:24px;height:24px;border:none;background:transparent;border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}",
      ".dsh-qo-collapse:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dsh-qo-list{flex:auto;min-height:0;overflow-y:auto;padding:6px;display:flex;flex-direction:column;gap:2px;overscroll-behavior:contain}",
      ".dsh-qo-item{width:100%;text-align:left;border:none;background:transparent;border-radius:8px;color:var(--dsw-alias-label-primary);cursor:pointer;padding:7px 8px;font-size:13px;line-height:18px;display:flex;align-items:flex-start;gap:8px}",
      ".dsh-qo-item:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".dsh-qo-index{flex-shrink:0;min-width:18px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-align:right;font-variant-numeric:tabular-nums}",
      ".dsh-qo-text{flex:auto;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}",
      ".dsh-qo-item-pending .dsh-qo-text{color:var(--dsw-alias-label-tertiary)}",
      ".dsh-qo-pending-badge{flex-shrink:0;align-self:center;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);border-radius:6px;padding:1px 6px;font-size:10px;line-height:16px;white-space:nowrap;font-weight:500}",
      ".dsh-qo-empty{padding:16px 12px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:18px;text-align:center}",
      ".dsh-qo-highlight{border-radius:12px;animation:dsh-qo-flash 2.5s ease-out}",
      "@keyframes dsh-qo-flash{0%{background:var(--dsw-alias-brand-tertiary,rgba(77,107,254,.22))}55%{background:var(--dsw-alias-brand-tertiary,rgba(77,107,254,.22))}100%{background:transparent}}",
      "@media (prefers-reduced-motion:reduce){.dsh-qo-highlight{animation:none;background:var(--dsw-alias-brand-tertiary,rgba(77,107,254,.22))}}"
    ].join("\n");

    var COLLAPSE_ICON = h(
      "svg",
      { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
      h("path", { d: "M9 5l7 7-7 7" })
    );

    // ---- 纯工具函数（与 ctx 无关）----

    function injectCss() {
      if (typeof document === "undefined") return null;
      var existing = document.getElementById(STYLE_ID);
      if (existing) return existing;
      var tag = document.createElement("style");
      tag.id = STYLE_ID;
      tag.dataset.plugin = "dsh-my-questions-outline";
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return tag;
    }

    function removeAll(root, selector) {
      var nodes = root.querySelectorAll(selector);
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.parentNode) n.parentNode.removeChild(n);
      }
    }

    // 从用户消息 DOM 节点提取干净正文：克隆后剔除时间戳与辅助元素，再折叠空白。
    function extractQuestionText(el) {
      var clone = el.cloneNode(true);
      removeAll(clone, '[class*="timeStart"], [class*="timeEnd"], [class*="visuallyHidden"]');
      var text = (clone.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length > MAX_TEXT_LENGTH) text = text.slice(0, MAX_TEXT_LENGTH) + "…";
      return text;
    }

    function scanDom() {
      var els = document.querySelectorAll(FLOW_KIND_SELECTOR);
      var items = [];
      for (var i = 0; i < els.length; i++) {
        var key = els[i].getAttribute(ANCHOR_ATTR);
        if (!key) continue;
        var text = extractQuestionText(els[i]);
        if (text === "") text = FALLBACK_LABEL;
        items.push({ key: key, text: text });
      }
      return items;
    }

    function findMessageEl(key) {
      var els = document.querySelectorAll("[" + ANCHOR_ATTR + "]");
      for (var i = 0; i < els.length; i++) {
        if (els[i].getAttribute(ANCHOR_ATTR) === key) return els[i];
      }
      return null;
    }

    // 滚到会话顶部：露出最早的已加载内容与「加载更早」按钮。
    // 不程序化点击任何按钮，避免干扰 DSH 自身的分页/滚动状态。
    function scrollConversationToTop() {
      try {
        var scroll = document.querySelector("[data-conversation-scroll]");
        if (scroll) scroll.scrollTop = 0;
      } catch (e) { /* ignore */ }
    }

    function scrollToElement(el) {
      try {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (e) {
        try { el.scrollIntoView(true); } catch (e2) { /* ignore */ }
      }
    }

    function highlightElement(el) {
      el.classList.add(HIGHLIGHT_CLASS);
      var prev = el.__dshQoHighlightTimer;
      if (prev) clearTimeout(prev);
      el.__dshQoHighlightTimer = setTimeout(function () {
        el.classList.remove(HIGHLIGHT_CLASS);
        el.__dshQoHighlightTimer = null;
      }, HIGHLIGHT_MS);
    }

    // 合并必须始终「旧 → 新」。DOM 顺序是权威（旧在上、新在下）；
    // 持久化里「当前不在 DOM 里」的条目属于更早的历史（已被分页顶出），前置到最前。
    function mergeItems(persisted, dom) {
      var seen = {};
      var result = [];
      var domKeys = {};
      var i, item;
      for (i = 0; i < dom.length; i++) domKeys[dom[i].key] = true;
      // 1) 更早的历史（已持久化但当前不在 DOM）——按持久化顺序前置
      for (i = 0; i < persisted.length; i++) {
        item = persisted[i];
        if (!item || typeof item.key !== "string" || seen[item.key]) continue;
        if (domKeys[item.key]) continue;
        seen[item.key] = true;
        result.push({ key: item.key, text: typeof item.text === "string" ? item.text : "", loaded: false });
      }
      // 2) 当前 DOM 条目——以 DOM 顺序为准，并用 DOM 文本刷新
      for (i = 0; i < dom.length; i++) {
        item = dom[i];
        if (seen[item.key]) continue;
        seen[item.key] = true;
        result.push({ key: item.key, text: item.text, loaded: true });
      }
      return result;
    }

    function sameItems(a, b) {
      if (!a || !b || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (a[i].key !== b[i].key || a[i].text !== b[i].text || !!a[i].loaded !== !!b[i].loaded) return false;
      }
      return true;
    }

    function storageKey(sessionId) {
      return STORAGE_PREFIX + sessionId;
    }

    function loadPersisted(sessionId) {
      if (!sessionId) return [];
      try {
        var raw = localStorage.getItem(storageKey(sessionId));
        if (!raw) return [];
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) return parsed.items;
      } catch (e) { /* ignore */ }
      return [];
    }

    function savePersisted(sessionId, items) {
      if (!sessionId) return;
      try {
        localStorage.setItem(storageKey(sessionId), JSON.stringify({ version: 1, items: items }));
        touchSession(sessionId);
      } catch (e) { /* quota / private mode */ }
    }

    // 维护「最近更新」的会话键集合，超过上限时淘汰最旧的会话数据，避免 localStorage 无限膨胀。
    function touchSession(sessionId) {
      var meta = [];
      try { meta = JSON.parse(localStorage.getItem(STORAGE_INDEX) || "[]"); } catch (e) { meta = []; }
      if (!Array.isArray(meta)) meta = [];
      meta = meta.filter(function (x) { return x && typeof x.id === "string" && x.id !== sessionId; });
      meta.unshift({ id: sessionId, ts: Date.now() });
      var evicted = meta.slice(MAX_SESSIONS);
      meta = meta.slice(0, MAX_SESSIONS);
      try { localStorage.setItem(STORAGE_INDEX, JSON.stringify(meta)); } catch (e) { /* ignore */ }
      for (var i = 0; i < evicted.length; i++) {
        try { localStorage.removeItem(storageKey(evicted[i].id)); } catch (e) { /* ignore */ }
      }
    }

    // 侧边栏垂直位置（距视口顶部 px）——默认贴在会话 header 下方，可拖动并记住（仅拖动后持久化）。
    function loadTop() {
      try {
        var raw = localStorage.getItem(STORAGE_TOP);
        if (raw !== null) {
          var n = Number(raw);
          if (Number.isFinite(n) && n >= 0) return n;
        }
      } catch (e) { /* ignore */ }
      return null;
    }

    // 默认位置：贴在会话 header 下方（不遮挡标题/面包屑/操作按钮）。
    function defaultTopBelowHeader() {
      try {
        var scroll = document.querySelector("[data-conversation-scroll]");
        var header = scroll ? scroll.previousElementSibling : null;
        if (header && header.tagName === "HEADER") {
          var bottom = header.getBoundingClientRect().bottom;
          if (bottom > 0 && bottom < window.innerHeight) return Math.round(bottom + 8);
        }
      } catch (e) { /* ignore */ }
      return DEFAULT_TOP;
    }

    function computeInitialTop() {
      var saved = loadTop();
      return saved !== null ? saved : defaultTopBelowHeader();
    }

    function saveTop(top) {
      try { localStorage.setItem(STORAGE_TOP, String(Math.round(top))); } catch (e) { /* ignore */ }
    }

    // ---- 插件主体 ----

    var inject = ["slots", "sessions"];

    function apply(ctx) {
      ctx.effect(function () {
        var tag = injectCss();
        return function () {
          if (tag && tag.parentNode) tag.parentNode.removeChild(tag);
        };
      });

      function getSessionId() {
        try {
          var s = ctx.sessions;
          if (s && s.list && typeof s.list.getSnapshot === "function") {
            var cur = s.list.getSnapshot().current;
            return typeof cur === "string" ? cur : "";
          }
        } catch (e) { /* ignore */ }
        return "";
      }

      // 点击条目：目标在 DOM → 直接滚动高亮；否则滚到会话顶部（不自动点「加载更早」）。
      function revealAndGo(key) {
        var el = findMessageEl(key);
        if (el) { scrollToElement(el); highlightElement(el); return; }
        scrollConversationToTop();
      }

      function OutlineSidebar() {
        var itemsState = React.useState([]);
        var items = itemsState[0];
        var setItems = itemsState[1];
        var expandedState = React.useState(true);
        var expanded = expandedState[0];
        var setExpanded = expandedState[1];

        var lastItemsRef = React.useRef(null);
        var rootRef = React.useRef(null);

        var topState = React.useState(computeInitialTop);
        var top = topState[0];
        var setTop = topState[1];
        var topRef = React.useRef(top);
        var suppressClickRef = React.useRef(false);
        var dragRef = React.useRef(null);

        React.useEffect(function () {
          topRef.current = top;
        }, [top]);

        function startDrag(e) {
          if (e.button !== 0) return;
          var startY = e.clientY;
          var startTop = topRef.current;
          dragRef.current = { startY: startY, startTop: startTop, moved: false, lastTop: startTop };
          var onMove = function (ev) {
            var d = dragRef.current;
            if (!d) return;
            var dy = ev.clientY - d.startY;
            if (!d.moved) {
              if (Math.abs(dy) < 4) return;
              d.moved = true;
              suppressClickRef.current = true;
            }
            var next = d.startTop + dy;
            if (next < 8) next = 8;
            if (next > window.innerHeight - 120) next = window.innerHeight - 120;
            d.lastTop = next;
            setTop(next);
          };
          var onUp = function () {
            if (dragRef.current && dragRef.current.moved) saveTop(dragRef.current.lastTop);
            dragRef.current = null;
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        }

        React.useEffect(function () {
          var observer = null;
          var debounceTimer = null;

          function rescan() {
            var sessionId = getSessionId();
            var dom = scanDom();
            var persisted = loadPersisted(sessionId);
            var merged = mergeItems(persisted, dom);
            if (merged.length > MAX_ITEMS_PER_SESSION) merged = merged.slice(merged.length - MAX_ITEMS_PER_SESSION);
            if (!sameItems(merged, lastItemsRef.current)) {
              lastItemsRef.current = merged;
              setItems(merged);
              if (merged.length > 0) {
                savePersisted(sessionId, merged.map(function (it) { return { key: it.key, text: it.text }; }));
              }
            }
          }

          rescan();
          observer = new MutationObserver(function () {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(rescan, RESCAN_DEBOUNCE_MS);
          });
          observer.observe(document.body, { childList: true, subtree: true });

          return function () {
            if (debounceTimer) clearTimeout(debounceTimer);
            if (observer) observer.disconnect();
          };
        }, []);

        function onItemClick(key) {
          revealAndGo(key);
        }

        function renderStrip() {
          return h(
            "button",
            {
              type: "button",
              className: "dsh-qo-strip",
              title: "我的提问大纲（可拖动）",
              "aria-label": "展开我的提问大纲",
              onPointerDown: startDrag,
              onClick: function () {
                if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                setExpanded(true);
              }
            },
            h("span", { className: "dsh-qo-strip-label" }, "大纲"),
            h("span", { className: "dsh-qo-badge" }, String(items.length))
          );
        }

        function renderPanel() {
          var listChildren = items.length === 0
            ? [h("div", { className: "dsh-qo-empty" }, "暂无提问")]
            : items.map(function (item, i) {
                var pending = item.loaded === false;
                var title = pending
                  ? item.text + "（该消息尚未加载到页面，点击会滚到会话顶部，请点「加载更早」后重试）"
                  : item.text;
                return h(
                  "button",
                  {
                    key: item.key,
                    type: "button",
                    className: pending ? "dsh-qo-item dsh-qo-item-pending" : "dsh-qo-item",
                    title: title,
                    onClick: function () { onItemClick(item.key); }
                  },
                  h("span", { className: "dsh-qo-index" }, String(i + 1)),
                  h("span", { className: "dsh-qo-text" }, item.text),
                  pending ? h("span", { className: "dsh-qo-pending-badge" }, "未加载") : null
                );
              });

          return h(
            "div",
            { className: "dsh-qo-panel" },
            h(
              "div",
              { className: "dsh-qo-header", title: "拖动调整位置", onPointerDown: startDrag },
              h("span", { className: "dsh-qo-title" }, "我的提问大纲"),
              h(
                "button",
                {
                  type: "button",
                  className: "dsh-qo-collapse",
                  title: "收起",
                  "aria-label": "收起我的提问大纲",
                  onPointerDown: function (e) { e.stopPropagation(); },
                  onClick: function () { setExpanded(false); }
                },
                COLLAPSE_ICON
              )
            ),
            h("div", { className: "dsh-qo-list" }, listChildren)
          );
        }

        return h("div", { ref: rootRef, className: "dsh-qo-root", style: { top: top + "px" } }, expanded ? renderPanel() : renderStrip());
      }

      ctx.slots.inject("shell.overlay", function () {
        return ctx.slots.register(
          { name: "shell.overlay", id: "dsh-my-questions-outline", order: 100 },
          function () { return h(OutlineSidebar); }
        );
      });
    }

    exports.name = "dsh-my-questions-outline";
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
