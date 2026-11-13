import type { Ctx, LoadViewApi } from "./ctx";
import type { El } from "../scene";
import type { Algo, LoadSpec, Role } from "../load/types";
import { ENTRY, ROLES } from "../load/graph";
import { detectRole } from "../load/detect";
import { fmt } from "../load/model";
import { isCurve, pointAtT } from "../connectors";
import { Disposer, createUpdater, h, setAttr, setText, setPressed } from "./dom";
import { glyphMore } from "./glyphs-more";
import { svgIcon } from "./glyphs";
import { clampPos } from "./props-pos";
import { level, loadColours, pctText } from "./load-draw";
import { theme } from "../theme";
import {
  ALGO_GLYPH, ALGO_LABEL, ALGO_ORDER, ALGO_TEXT, NUM, ROLE_LABEL, ROLE_ORDER, SPIKE_DEFAULT, canHaveRole, checkNum, checkSpike, detectSource, fieldsFor, formatNum, labelFor, placeCard,
  type Box, type Checked, type NumKey,
} from "./load-fields";

const CARD_W = 284;
const PHONE = "(max-width: 600px)";

const effRole = (e: El): Role => (e.load?.role && ROLES.includes(e.load.role) ? e.load.role : (detectRole(e) ?? "service"));

export interface LoadCard { el: HTMLElement; render(): void; dispose(): void }

interface NumSpec { id: string; label: string; hint: string; unit: string; placeholder: string; check(t: string): Checked; get(): number | undefined; apply(v: number | undefined): void }

/**
 * The Load card: the numbers of ONE selected service or arrow while Load view is on. Opens only for a single selection, never by
 * itself; sits beside the element (flips near an edge, clamped, off the dock and the top cluster), follows pan and zoom with a
 * transform, drags by its grip (stays where dragged for this session). On a phone it is a bottom sheet. Inputs commit on change /
 * Enter / blur through editor.setLoad (one undo step each); Esc reverts the field. Read-only (shared view, locked element): values only.
 */
export function mountLoadCard(ctx: Ctx, parent: HTMLElement, lv: LoadViewApi): LoadCard {
  const { editor } = ctx;
  const d = new Disposer();
  const mq = matchMedia(PHONE);
  let dragged: { x: number; y: number } | null = null;
  let key = "", curId = "";
  let syncs: Array<() => void> = [];
  let size = { w: CARD_W, h: 200 };
  const cur = (): El | undefined => editor.scene.els.get(curId);

  const grip = h("button", { class: "ap-grip", attrs: { type: "button", title: "Drag to move · double-click to follow the shape again", "aria-label": "Move the load card" } }, glyphMore("grip", 16));
  const title = h("span", { class: "lc-title" });
  const badge = h("span", { class: "lc-badge" });
  const head = h("div", { class: "lc-head" }, grip, title, badge);
  const body = h("div", { class: "lc-body" });
  const el = h("section", { class: "ap-lcard ap-card ap-hit", attrs: { "aria-label": "Load", role: "group" } }, head, body);
  el.hidden = true;
  parent.append(el);

  /* ---------- placement ---------- */
  const place = (e: El) => {
    if (mq.matches) { el.style.transform = ""; return; }
    const vp = editor.vp, z = vp.zoom;
    let a: Box;
    if (e.kind === "arrow" && e.pts.length >= 4) { const p: [number, number] = [0, 0]; pointAtT(e.pts, isCurve(e), 0.5, p); a = { x: (p[0] - vp.x) * z - 8, y: (p[1] - vp.y) * z - 8, w: 16, h: 16 }; }
    else a = { x: (e.x - vp.x) * z, y: (e.y - vp.y) * z, w: e.w * z, h: e.h * z };
    const r = el.getBoundingClientRect();
    if (r.width > 0) size = { w: r.width, h: r.height };
    let pos: { x: number; y: number };
    if (dragged) pos = clampPos(dragged, size.w, size.h, innerWidth, innerHeight);
    else {
      const cl = document.querySelector(".ap-cluster")?.getBoundingClientRect(), dk = document.querySelector(".ap-dock")?.getBoundingClientRect();
      const avoid: Box[] = [];
      for (const s of [".ap-lchart", ".ap-ribbon", ".ap-scn"]) {
        const n = document.querySelector<HTMLElement>(s);
        if (n && !n.hidden) { const b = n.getBoundingClientRect(); if (b.width > 0) avoid.push({ x: b.left, y: b.top, w: b.width, h: b.height }); }
      }
      pos = placeCard(a, size, { l: 8, t: (cl ? cl.bottom : 52) + 8, r: innerWidth - 8, b: (dk ? dk.top : innerHeight - 70) - 8 }, avoid);
    }
    el.style.transform = `translate(${Math.round(pos.x)}px,${Math.round(pos.y)}px)`;
  };
  let drag: { dx: number; dy: number; id: number } | null = null;
  grip.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || mq.matches) return;
    const r = el.getBoundingClientRect();
    drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top, id: ev.pointerId };
    try { grip.setPointerCapture(ev.pointerId); } catch { /* synthetic pointer */ }
    ev.preventDefault();
  });
  grip.addEventListener("pointermove", (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const r = el.getBoundingClientRect();
    dragged = clampPos({ x: ev.clientX - drag.dx, y: ev.clientY - drag.dy }, r.width, r.height, innerWidth, innerHeight);
    el.style.transform = `translate(${Math.round(dragged.x)}px,${Math.round(dragged.y)}px)`;
  });
  const endDrag = (ev: PointerEvent) => { if (drag && ev.pointerId === drag.id) drag = null; };
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);
  grip.addEventListener("dblclick", () => { dragged = null; u.schedule(); });

  /* ---------- building the fields of one element ---------- */
  const commitLoad = (patch: Partial<LoadSpec>) => { if (curId) editor.setLoad([curId], patch); };

  /** one labelled number input (or a read-only value). Commits on change/Enter/blur, Esc reverts, invalid text is flagged and never committed. */
  const numRow = (s: NumSpec, ro: boolean): HTMLElement => {
    const lab = h("label", { class: "lc-lab", text: s.label, attrs: { for: s.id, title: s.hint } });
    if (ro) {
      const v = h("span", { class: "lc-val", attrs: { id: s.id } });
      syncs.push(() => { const n = s.get(); setText(v, n === undefined ? s.placeholder : formatNum(n) + s.unit); });
      return h("div", { class: "lc-f" }, lab, v);
    }
    const err = h("span", { class: "lc-err", attrs: { id: s.id + "-e", role: "alert" } });
    const input = h("input", { class: "ap-input lc-in", attrs: { id: s.id, type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", placeholder: s.placeholder, "aria-describedby": s.id + "-e" } });
    const flag = (msg: string) => { setAttr(input, "aria-invalid", msg ? "true" : null); setText(err, msg); };
    const paint = () => { const v = s.get(); input.value = v === undefined ? "" : formatNum(v); };
    const bad = (t: string): string => { const r = s.check(t); return r.ok ? "" : r.msg; };
    input.addEventListener("focus", () => { const v = s.get(); input.value = v === undefined ? "" : String(v); input.select(); });
    input.addEventListener("input", () => flag(bad(input.value)));
    input.addEventListener("change", () => {
      const r = s.check(input.value);
      if (!r.ok) { flag(r.msg); return; }
      flag("");
      s.apply(r.value);
    });
    input.addEventListener("blur", () => { flag(""); paint(); });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); const m = bad(input.value); if (m) flag(m); else input.blur(); }
      else if (ev.key === "Escape") { ev.stopPropagation(); flag(""); paint(); input.blur(); }
    });
    syncs.push(() => { if (document.activeElement !== input) paint(); });
    return h("div", { class: "lc-f" }, lab, h("div", { class: "lc-iw" }, input, s.unit ? h("span", { class: "lc-unit", text: s.unit }) : null), err);
  };

  const specNum = (role: Role | "arrow", k: NumKey): NumSpec => ({
    id: `lc-${k}`, label: labelFor(role, k), hint: NUM[k].hint, unit: NUM[k].unit, placeholder: NUM[k].placeholder,
    check: (t) => checkNum(NUM[k], t), get: () => cur()?.load?.[k], apply: (v) => commitLoad({ [k]: v } as Partial<LoadSpec>),
  });

  const segment = (label: string, items: ReadonlyArray<readonly [string, string]>, get: () => string, set: (v: string) => void, ro: boolean) => {
    const btns = items.map(([v, t]) => h("button", { attrs: { type: "button", role: "radio", "aria-checked": "false", disabled: ro }, text: t, on: { click: () => set(v) } }));
    const wrap = h("div", { class: "ap-seg lc-seg", attrs: { role: "radiogroup", "aria-label": label } }, ...btns);
    syncs.push(() => { const g = get(); btns.forEach((b, i) => setPressed(b, items[i]![0] === g, "aria-checked")); });
    return wrap;
  };

  const build = (e: El, role: Role | "arrow", ro: boolean) => {
    body.textContent = ""; syncs = [];
    const spec = e.load ?? {};
    if (role !== "arrow") {
      const sel = h("select", { class: "ap-input lc-sel", attrs: { id: "lc-role", disabled: ro } });
      sel.append(h("option", { attrs: { value: "" }, text: `auto: ${ROLE_LABEL[detectRole(e) ?? "service"].toLowerCase()}` }));
      for (const r of ROLE_ORDER) sel.append(h("option", { attrs: { value: r }, text: ROLE_LABEL[r] }));
      sel.addEventListener("change", () => commitLoad({ role: (sel.value || undefined) as Role | undefined }));
      const why = h("div", { class: "lc-why" });
      body.append(h("div", { class: "lc-f" }, h("label", { class: "lc-lab", text: "Acts as", attrs: { for: "lc-role" } }), sel), why);
      syncs.push(() => {
        const s = cur(); if (!s) return;
        sel.value = s.load?.role && ROLES.includes(s.load.role) ? s.load.role : "";
        const src = detectSource(s);
        setText(why, s.load?.role ? "Set by you." : src ? `Detected from the ${src}. Change it if that is wrong.` : "Nothing detected, so it acts as a plain service. Pick what it is.");
      });
    } else body.append(h("div", { class: "lc-why", text: "How the source's traffic is divided between its arrows, and how many calls each request makes." }));

    const keys = fieldsFor(role, spec);
    if (role === "limiter") {
      body.append(segment("Algorithm", ALGO_ORDER.map((a) => [a, ALGO_LABEL[a]] as const), () => cur()?.load?.algo ?? "token", (v) => commitLoad({ algo: v as Algo }), ro));
      const glyph = svgIcon(`<path d="${ALGO_GLYPH.token}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`, 64);
      glyph.setAttribute("viewBox", "0 0 64 30"); glyph.setAttribute("height", "30");
      const txt = h("span", { class: "lc-gtxt" });
      body.append(h("div", { class: "lc-glyph" }, glyph, txt));
      syncs.push(() => { const al = cur()?.load?.algo ?? "token"; glyph.querySelector("path")?.setAttribute("d", ALGO_GLYPH[al]); setText(txt, ALGO_TEXT[al]); });
    }
    for (const k of keys) body.append(numRow(specNum(role, k), ro));
    if (role === "lb") body.append(h("div", { class: "lc-why", text: "Spreads by capacity when its targets have one. Set arrow weights to override." }));
    if (role === "entry") {
      if (spec.retries) {
        const b = h("button", { class: "ap-btn lc-tgl", attrs: { type: "button", "aria-pressed": "false", disabled: ro }, text: "backoff + jitter", on: { click: () => commitLoad({ backoff: cur()?.load?.backoff === 1 ? 0 : 1 }) } });
        body.append(h("div", { class: "lc-f" }, h("span", { class: "lc-lab", text: "Retry pacing" }), b));
        syncs.push(() => setPressed(b, cur()?.load?.backoff === 1));
      }
      if (!spec.spike) {
        if (!ro) body.append(h("button", { class: "lc-link", attrs: { type: "button" }, text: "+ add traffic spike", on: { click: () => commitLoad({ spike: [...SPIKE_DEFAULT] }) } }));
      } else {
        const sp = (i: 0 | 1 | 2, label: string, unit: string, hint: string): NumSpec => ({
          id: `lc-sp${i}`, label, hint, unit, placeholder: "",
          check: (t) => checkSpike(i, t), get: () => cur()?.load?.spike?.[i],
          apply: (v) => { const s = cur()?.load?.spike; if (s && v !== undefined) { const n: [number, number, number] = [s[0], s[1], s[2]]; n[i] = v; commitLoad({ spike: n }); } },
        });
        body.append(h("div", { class: "lc-spike" },
          h("div", { class: "lc-sh" }, h("span", { class: "lc-lab", text: "Traffic spike" }), ro ? null : h("button", { class: "lc-link", attrs: { type: "button" }, text: "remove", on: { click: () => commitLoad({ spike: undefined }) } })),
          numRow(sp(0, "Multiplier", "×", "Traffic is this many times the normal rate during the spike"), ro),
          numRow(sp(1, "Starts at", " s", "Seconds after the start of the scenario"), ro),
          numRow(sp(2, "Lasts", " s", "How long the spike lasts, in seconds"), ro)));
      }
    }

    /* results + warnings from the engine (updated by sync) */
    const res = h("div", { class: "lc-res" }), warn = h("div", { class: "lc-warn", attrs: { role: "status" } });
    const wtext = h("div"), wact = h("button", { class: "ap-btn lc-wbtn", attrs: { type: "button" }, text: "Turn on backoff + jitter", on: { click: () => commitLoad({ backoff: 1 }) } });
    warn.append(wtext, wact);
    body.append(res, warn);
    syncs.push(() => result(res, warn, wtext, wact, role, ro));
  };

  /* ---------- result row + warnings ---------- */
  const stat = (label: string, value: string, lv2?: "ok" | "warn" | "bad" | null) => {
    const c = lv2 ? loadColours(theme.paper)[lv2] : "";
    const v = h("b", { class: "lc-n", text: value });
    if (c) v.style.color = c;
    return h("span", { class: "lc-stat" }, label + " ", v);
  };
  const result = (res: HTMLElement, warn: HTMLElement, wtext: HTMLElement, wact: HTMLElement, role: Role | "arrow", ro: boolean) => {
    const st = lv.steady(), sr = lv.source(), e = cur();
    const kids: Node[] = [];
    const lines: string[] = [];
    let showBackoff = false;
    if (st && sr && e) {
      const g = st.g;
      if (role === "arrow") {
        const ei = g.edgeIndex.get(e.id);
        if (ei !== undefined) kids.push(stat("carries", fmt(sr.edge(ei)) + "/s"));
      } else {
        const v = g.nodeIndex.get(e.id);
        if (v === undefined) kids.push(h("span", { class: "lc-stat", text: "Not connected to an arrow yet." }));
        else {
          const nm = g.names[v]!;
          const u = sr.util(v);
          if (g.role[v] === ENTRY) {
            const amp = sr.frame ? sr.amp() : st.amp[v]!;
            kids.push(st.e2eSat[v] ? stat("end-to-end", "saturated", "bad") : stat("end-to-end est.", `~${Math.round(st.e2e[v]!)} ms`), stat("amplification", `×${amp.toFixed(1)}`, amp > 1.2 ? "warn" : null));
            if (amp > 1.2 && !g.backoff[v]) showBackoff = !ro;
            if (sr.frame && amp > 1.2) lines.push(`Retry amplification \u00d7${amp.toFixed(1)} right now`);
          } else {
            if (u === u) kids.push(stat("util", pctText(u), level(u)));
            if (st.sat[v]) kids.push(stat("latency", "saturated", "bad")); else if (u === u) kids.push(stat("latency est.", `~${Math.round(st.lat[v]!)} ms`));
            const dr = sr.dropped(v), bl = sr.backlog(v);
            if (role === "queue") kids.push(stat(bl >= 0 ? "backlog" : "backlog", bl >= 0 ? fmt(bl) : st.growth[v]! > 0.5 ? `+${fmt(st.growth[v]!)}/s` : "draining"));
            else if (dr >= 0.5) kids.push(stat(role === "limiter" ? "rejects" : "drops", fmt(dr) + "/s", "bad"));
            if (role === "cache" && g.hasCap[v]) { const sv = Math.min(sr.in(v), g.cap[v]!); kids.push(stat("hits", fmt(sv * g.hit[v]!) + "/s")); }
          }
          for (const w of st.warnings) if (g.role[v] === ENTRY ? w.endsWith(" at " + nm) : w.startsWith(nm + " ")) lines.push(w);
        }
      }
    }
    res.replaceChildren(...kids);
    setText(wtext, lines.join(" · "));
    warn.hidden = lines.length === 0;
    wact.hidden = !showBackoff || lines.length === 0;
    if (showBackoff && lines.length > 0) setText(wtext, lines.join(" · ") + ". Retries pile onto the overload: backoff + jitter spreads them out.");
  };

  /* ---------- render ---------- */
  const render = () => {
    const sel = editor.selection(), st = lv.steady();
    let e: El | undefined, role: Role | "arrow" | null = null;
    if (sel.size === 1 && st && !editor.editing) {
      e = editor.scene.els.get([...sel][0]!);
      if (e) {
        if (e.kind === "arrow") { if (st.g.edgeIndex.has(e.id)) role = "arrow"; }
        else if (canHaveRole(e.kind)) role = effRole(e);
      }
    }
    if (!e || !role) { if (!el.hidden) { el.hidden = true; key = ""; curId = ""; } return; }
    curId = e.id;
    const ro = editor.readOnly || editor.scene.isLocked(e);
    const k = [e.id, role, ro, e.load?.algo ?? "", !!e.load?.retries, !!e.load?.spike].join("|");
    if (k !== key) {
      key = k;
      const fid = body.contains(document.activeElement) ? (document.activeElement as HTMLElement).id : ""; // a rebuild must not drop the field being tabbed into
      build(e, role, ro);
      if (fid) document.getElementById(fid)?.focus();
    }
    el.hidden = false;
    setText(title, (e.kind === "arrow" ? "" : e.text.split("\n")[0]!.trim()) || (role === "arrow" ? "Arrow" : ROLE_LABEL[role]));
    setText(badge, role === "arrow" ? "arrow" : ro ? ROLE_LABEL[role].toLowerCase() + " · read-only" : ROLE_LABEL[role].toLowerCase());
    for (const f of syncs) f();
    place(e);
  };
  const u = createUpdater("load-card", render);
  d.add(() => u.cancel());
  for (const ev of ["selection", "change", "history", "viewport", "edit", "tool"] as const) d.add(editor.on(ev, () => u.schedule()));
  d.add(lv.subscribe(() => u.schedule()));
  d.on(window, "resize", () => u.schedule());
  const onMq = () => u.schedule();
  mq.addEventListener("change", onMq);
  d.add(() => mq.removeEventListener("change", onMq));
  u.schedule();

  return { el, render, dispose() { d.dispose(); el.remove(); } };
}
