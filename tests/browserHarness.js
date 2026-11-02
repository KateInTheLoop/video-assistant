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
    const children = [], selectors = new Map();
    return {
      value: "", textContent: "", checked: false, disabled: false,
      get innerHTML() { return ""; }, set innerHTML(value) { if (value === "") children.length = 0; },
      setAttribute(name, value) { this[name] = value; }, getAttribute(name) { return this[name] ?? null; },
      hidden: false, style: {}, dataset: {}, files: [], children,
      get lastChild() { return children.at(-1); },
      options: [{ value: "claude-haiku-5-5" }, { value: "full" }],
      classList: { add() {}, remove() {}, toggle() {} },
      append(...els) { children.push(...els); }, appendChild(el) { children.push(el); },
      querySelector(sel) { if (!selectors.has(sel)) selectors.set(sel, element()); return selectors.get(sel); },
      querySelectorAll() { return []; }, click() {}, scrollIntoView() {},
      dispatchEvent(ev) { for (const fn of listeners.get(ev.type) || []) fn({ ...ev, target: this }); },
    };
  }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const globals = {
    console, Date, performance, URL, Blob, Event, Uint8Array, TextDecoder, structuredClone,
    document: {
      getElementById: $, createElement: element,
      createTextNode: text => ({ textContent: text }),
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
