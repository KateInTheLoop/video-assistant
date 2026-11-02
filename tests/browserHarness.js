// Exercise the actual browser event handlers with local DOM, media and API substitutes.
import vm from "node:vm";
import { readFileSync } from "node:fs";

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export async function browserHarness(file, overrides = {}) {
  const nodes = new Map(), listeners = new Map(), timers = new Map();
  let seq = 0;
  function element() {
    const children = [], selectors = new Map(), classes = new Set();
    return {
      value: "", textContent: "", checked: false, disabled: false,
      get innerHTML() { return ""; }, set innerHTML(value) { if (value === "") { children.forEach(el => { el.parentElement = null; }); children.length = 0; } },
      setAttribute(name, value) { this[name] = value; }, getAttribute(name) { return this[name] ?? null; },
      hidden: false, style: { setProperty(name, value) { this[name] = value; } }, dataset: {}, files: [], children,
      parentElement: null, clientWidth: 1280, clientHeight: 700, scrollHeight: 700, scrollTop: 0,
      get lastChild() { return children.at(-1); },
      options: [{ value: "claude-haiku-5-5" }, { value: "full" }],
      classList: { add(...names) { names.forEach(n => classes.add(n)); }, remove(...names) { names.forEach(n => classes.delete(n)); }, contains(name) { return classes.has(name); }, toggle(name, force = !classes.has(name)) { if (force) classes.add(name); else classes.delete(name); return force; } },
      append(...els) { els.forEach(el => this.appendChild(el)); },
      appendChild(el) { if (el.parentElement) { const old = el.parentElement.children, index = old.indexOf(el); if (index >= 0) old.splice(index, 1); } children.push(el); el.parentElement = this; return el; },
      insertBefore(el, before) { if (el.parentElement) el.remove(); const index = before ? children.indexOf(before) : -1; if (index < 0) children.push(el); else children.splice(index, 0, el); el.parentElement = this; return el; },
      remove() { if (this.parentElement) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; } },
      contains(el) { for (let node = el; node; node = node.parentElement) if (node === this) return true; return false; },
      getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; },
      querySelector(sel) { if (!selectors.has(sel)) selectors.set(sel, element()); return selectors.get(sel); },
      querySelectorAll() { return []; }, click() {}, scrollIntoView() {},
      focus() { globals.document.activeElement = this; },
      dispatchEvent(ev) { for (const fn of listeners.get(ev.type) || []) fn({ ...ev, target: this }); },
    };
  }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const globals = {
    console, Date, performance, URL, Blob, Event, Uint8Array, TextDecoder, structuredClone,
    document: {
      getElementById: $, createElement: element,
      createTextNode: text => ({ textContent: text, get nodeValue() { return this.textContent; }, set nodeValue(value) { this.textContent = value; } }),
      addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
      dispatchEvent(ev) { for (const fn of listeners.get(ev.type) || []) fn(ev); },
    },
    localStorage: { getItem() {}, setItem() {} }, location: { hash: "" },
    window: { innerWidth: 1280, addEventListener() {} },
    setTimeout(fn) { const id = ++seq; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }, setInterval() {}, clearInterval() {},
    requestAnimationFrame(fn) { const id = ++seq; timers.set(id, fn); return id; },
    cancelAnimationFrame(id) { timers.delete(id); },
  };
  let source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  for (const match of source.matchAll(/^import \{([^}]+)\} from "([^"]+)";$/gm)) {
    const imported = await import(new URL(`../${match[2]}`, import.meta.url));
    for (const name of match[1].split(",").map(s => s.trim())) globals[name] = imported[name];
  }
  source = source.replace(/^import .*;\n/gm, "").replace(/^\(async \(\) => \{/m, "globalThis.boot = (async () => {");
  const context = vm.createContext({ ...globals, ...overrides });
  vm.runInContext(source, context, { filename: file });
  await context.boot;
  return { $, context, timers, run: code => vm.runInContext(code, context) };
}
