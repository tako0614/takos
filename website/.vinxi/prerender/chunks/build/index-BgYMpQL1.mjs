import { isServer, createComponent, useAssets, ssr, spread, escape } from 'file:///website/node_modules/solid-js/web/dist/server.js';
import { sharedConfig, createContext, createUniqueId, useContext, createRenderEffect, onCleanup } from 'file:///website/node_modules/solid-js/dist/server.js';

const y = createContext(), v = ["title", "meta"], p = [], f = ["name", "http-equiv", "content", "charset", "media"].concat(["property"]), l = (r, t) => {
  const e = Object.fromEntries(Object.entries(r.props).filter(([n]) => t.includes(n)).sort());
  return (Object.hasOwn(e, "name") || Object.hasOwn(e, "property")) && (e.name = e.name || e.property, delete e.property), r.tag + JSON.stringify(e);
};
function M() {
  if (!sharedConfig.context) {
    const e = document.head.querySelectorAll("[data-sm]");
    Array.prototype.forEach.call(e, (n) => n.parentNode.removeChild(n));
  }
  const r = /* @__PURE__ */ new Map();
  function t(e) {
    if (e.ref) return e.ref;
    let n = document.querySelector(`[data-sm="${e.id}"]`);
    return n ? (n.tagName.toLowerCase() !== e.tag && (n.parentNode && n.parentNode.removeChild(n), n = document.createElement(e.tag)), n.removeAttribute("data-sm")) : n = document.createElement(e.tag), n;
  }
  return { addTag(e) {
    if (v.indexOf(e.tag) !== -1) {
      const i = e.tag === "title" ? p : f, a = l(e, i);
      r.has(a) || r.set(a, []);
      let s = r.get(a), u = s.length;
      s = [...s, e], r.set(a, s);
      let c = t(e);
      e.ref = c, spread(c, e.props);
      let d = null;
      for (var n = u - 1; n >= 0; n--) if (s[n] != null) {
        d = s[n];
        break;
      }
      return c.parentNode != document.head && document.head.appendChild(c), d && d.ref && d.ref.parentNode && document.head.removeChild(d.ref), u;
    }
    let o = t(e);
    return e.ref = o, spread(o, e.props), o.parentNode != document.head && document.head.appendChild(o), -1;
  }, removeTag(e, n) {
    const o = e.tag === "title" ? p : f, i = l(e, o);
    if (e.ref) {
      const a = r.get(i);
      if (a) {
        if (e.ref.parentNode) {
          e.ref.parentNode.removeChild(e.ref);
          for (let s = n - 1; s >= 0; s--) a[s] != null && document.head.appendChild(a[s].ref);
        }
        a[n] = null, r.set(i, a);
      } else e.ref.parentNode && e.ref.parentNode.removeChild(e.ref);
    }
  } };
}
function w() {
  const r = [];
  return useAssets(() => ssr(S(r))), { addTag(t) {
    if (v.indexOf(t.tag) !== -1) {
      const e = t.tag === "title" ? p : f, n = l(t, e), o = r.findIndex((i) => i.tag === t.tag && l(i, e) === n);
      o !== -1 && r.splice(o, 1);
    }
    return r.push(t), r.length;
  }, removeTag(t, e) {
  } };
}
const I = (r) => {
  const t = isServer ? w() : M();
  return createComponent(y.Provider, { value: t, get children() {
    return r.children;
  } });
}, C = (r, t, e) => (A({ tag: r, props: t, setting: e, id: createUniqueId(), get name() {
  return t.name || t.property;
} }), null);
function A(r) {
  const t = useContext(y);
  if (!t) throw new Error("<MetaProvider /> should be in the tree");
  createRenderEffect(() => {
    const e = t.addTag(r);
    onCleanup(() => t.removeTag(r, e));
  });
}
function S(r) {
  return r.map((t) => {
    var _a, _b;
    const n = Object.keys(t.props).map((i) => i === "children" ? "" : ` ${i}="${escape(t.props[i], true)}"`).join("");
    let o = t.props.children;
    return Array.isArray(o) && (o = o.join("")), ((_a = t.setting) == null ? void 0 : _a.close) ? `<${t.tag} data-sm="${t.id}"${n}>${((_b = t.setting) == null ? void 0 : _b.escape) ? escape(o) : o || ""}</${t.tag}>` : `<${t.tag} data-sm="${t.id}"${n}/>`;
  }).join("");
}
const k = (r) => C("title", r, { escape: true, close: true }), H = (r) => C("meta", r);

export { H, I, k };
//# sourceMappingURL=index-BgYMpQL1.mjs.map
