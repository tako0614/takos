import process from 'node:process';globalThis._importMeta_=globalThis._importMeta_||{url:"file:///_entry.js",env:process.env};import destr from 'file:///website/node_modules/destr/dist/index.mjs';
import { defineEventHandler, handleCacheHeaders, splitCookiesString, createEvent, fetchWithEvent, isEvent, eventHandler, setHeaders, createError, sendRedirect, proxyRequest, getRequestURL, setResponseStatus, getResponseHeader, setResponseHeaders, send, getRequestHeader, removeResponseHeader, appendResponseHeader, setResponseHeader, createApp, createRouter as createRouter$1, toNodeListener, lazyEventHandler } from 'file:///website/node_modules/nitropack/node_modules/h3/dist/index.mjs';
import { createHooks } from 'file:///website/node_modules/hookable/dist/index.mjs';
import { createFetch, Headers as Headers$1 } from 'file:///website/node_modules/ofetch/dist/node.mjs';
import { fetchNodeRequestHandler, callNodeRequestHandler } from 'file:///website/node_modules/node-mock-http/dist/index.mjs';
import { parseURL, withoutBase, joinURL, getQuery, withQuery, decodePath, withLeadingSlash, withoutTrailingSlash } from 'file:///website/node_modules/ufo/dist/index.mjs';
import { createStorage, prefixStorage } from 'file:///website/node_modules/unstorage/dist/index.mjs';
import unstorage_47drivers_47fs from 'file:///website/node_modules/unstorage/drivers/fs.mjs';
import unstorage_47drivers_47fs_45lite from 'file:///website/node_modules/unstorage/drivers/fs-lite.mjs';
import { digest } from 'file:///website/node_modules/ohash/dist/index.mjs';
import { klona } from 'file:///website/node_modules/klona/dist/index.mjs';
import defu, { defuFn } from 'file:///website/node_modules/defu/dist/defu.mjs';
import { snakeCase } from 'file:///website/node_modules/scule/dist/index.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getContext } from 'file:///website/node_modules/unctx/dist/index.mjs';
import { toRouteMatcher, createRouter } from 'file:///website/node_modules/radix3/dist/index.mjs';
import _I4HpcBBewrbnT_2vqisqiEhxD98fOTOBiAJRFbQCLFI from 'file:///website/node_modules/vinxi/lib/app-fetch.js';
import _DzwTVQiPxK427aLiDEPF5bke2RvTs4IQKtJObZJ404 from 'file:///website/node_modules/vinxi/lib/app-manifest.js';
import { promises } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'file:///website/node_modules/pathe/dist/index.mjs';
import { parseSetCookie } from 'file:///website/node_modules/cookie-es/dist/index.mjs';
import { sharedConfig, lazy, createComponent, createUniqueId, useContext, createRenderEffect, onCleanup, createContext, catchError, ErrorBoundary, Suspense, createSignal, children, createMemo, getOwner, on as on$1, runWithOwner, untrack, Show, createRoot, startTransition, resetErrorBoundaries, batch } from 'file:///website/node_modules/solid-js/dist/server.js';
import { renderToString, isServer, getRequestEvent, ssrElement, escape, mergeProps, ssr, createComponent as createComponent$1, useAssets, spread, renderToStream, ssrHydrationKey, NoHydration, Hydration, ssrAttribute, HydrationScript, delegateEvents } from 'file:///website/node_modules/solid-js/web/dist/server.js';
import { provideRequestEvent } from 'file:///website/node_modules/solid-js/web/storage/dist/storage.js';
import { eventHandler as eventHandler$1, H3Event, getRequestIP, parseCookies, getResponseStatus, getResponseStatusText, getCookie, setCookie, getResponseHeader as getResponseHeader$1, setResponseHeader as setResponseHeader$1, removeResponseHeader as removeResponseHeader$1, getResponseHeaders, getRequestURL as getRequestURL$1, getRequestWebStream, setResponseStatus as setResponseStatus$1, appendResponseHeader as appendResponseHeader$1, setHeader, sendRedirect as sendRedirect$1 } from 'file:///website/node_modules/h3/dist/index.mjs';
import { fromJSON, Feature, crossSerializeStream, getCrossReferenceHeader, toCrossJSONStream } from 'file:///website/node_modules/seroval/dist/esm/production/index.mjs';
import { AbortSignalPlugin, CustomEventPlugin, DOMExceptionPlugin, EventPlugin, FormDataPlugin, HeadersPlugin, ReadableStreamPlugin, RequestPlugin, ResponsePlugin, URLSearchParamsPlugin, URLPlugin } from 'file:///website/node_modules/seroval-plugins/dist/esm/production/web.mjs';

const serverAssets = [{"baseName":"server","dir":"/website/assets"}];

const assets$1 = createStorage();

for (const asset of serverAssets) {
  assets$1.mount(asset.baseName, unstorage_47drivers_47fs({ base: asset.dir, ignore: (asset?.ignore || []) }));
}

const storage = createStorage({});

storage.mount('/assets', assets$1);

storage.mount('data', unstorage_47drivers_47fs_45lite({"driver":"fsLite","base":"./.data/kv"}));
storage.mount('root', unstorage_47drivers_47fs({"driver":"fs","readOnly":true,"base":"/website"}));
storage.mount('src', unstorage_47drivers_47fs({"driver":"fs","readOnly":true,"base":"/website"}));
storage.mount('build', unstorage_47drivers_47fs({"driver":"fs","readOnly":false,"base":"/website/.vinxi"}));
storage.mount('cache', unstorage_47drivers_47fs({"driver":"fs","readOnly":false,"base":"/website/.vinxi/cache"}));

function useStorage(base = "") {
  return base ? prefixStorage(storage, base) : storage;
}

const Hasher = /* @__PURE__ */ (() => {
  class Hasher2 {
    buff = "";
    #context = /* @__PURE__ */ new Map();
    write(str) {
      this.buff += str;
    }
    dispatch(value) {
      const type = value === null ? "null" : typeof value;
      return this[type](value);
    }
    object(object) {
      if (object && typeof object.toJSON === "function") {
        return this.object(object.toJSON());
      }
      const objString = Object.prototype.toString.call(object);
      let objType = "";
      const objectLength = objString.length;
      objType = objectLength < 10 ? "unknown:[" + objString + "]" : objString.slice(8, objectLength - 1);
      objType = objType.toLowerCase();
      let objectNumber = null;
      if ((objectNumber = this.#context.get(object)) === void 0) {
        this.#context.set(object, this.#context.size);
      } else {
        return this.dispatch("[CIRCULAR:" + objectNumber + "]");
      }
      if (typeof Buffer !== "undefined" && Buffer.isBuffer && Buffer.isBuffer(object)) {
        this.write("buffer:");
        return this.write(object.toString("utf8"));
      }
      if (objType !== "object" && objType !== "function" && objType !== "asyncfunction") {
        if (this[objType]) {
          this[objType](object);
        } else {
          this.unknown(object, objType);
        }
      } else {
        const keys = Object.keys(object).sort();
        const extraKeys = [];
        this.write("object:" + (keys.length + extraKeys.length) + ":");
        const dispatchForKey = (key) => {
          this.dispatch(key);
          this.write(":");
          this.dispatch(object[key]);
          this.write(",");
        };
        for (const key of keys) {
          dispatchForKey(key);
        }
        for (const key of extraKeys) {
          dispatchForKey(key);
        }
      }
    }
    array(arr, unordered) {
      unordered = unordered === void 0 ? false : unordered;
      this.write("array:" + arr.length + ":");
      if (!unordered || arr.length <= 1) {
        for (const entry of arr) {
          this.dispatch(entry);
        }
        return;
      }
      const contextAdditions = /* @__PURE__ */ new Map();
      const entries = arr.map((entry) => {
        const hasher = new Hasher2();
        hasher.dispatch(entry);
        for (const [key, value] of hasher.#context) {
          contextAdditions.set(key, value);
        }
        return hasher.toString();
      });
      this.#context = contextAdditions;
      entries.sort();
      return this.array(entries, false);
    }
    date(date) {
      return this.write("date:" + date.toJSON());
    }
    symbol(sym) {
      return this.write("symbol:" + sym.toString());
    }
    unknown(value, type) {
      this.write(type);
      if (!value) {
        return;
      }
      this.write(":");
      if (value && typeof value.entries === "function") {
        return this.array(
          [...value.entries()],
          true
          /* ordered */
        );
      }
    }
    error(err) {
      return this.write("error:" + err.toString());
    }
    boolean(bool) {
      return this.write("bool:" + bool);
    }
    string(string) {
      this.write("string:" + string.length + ":");
      this.write(string);
    }
    function(fn) {
      this.write("fn:");
      if (isNativeFunction(fn)) {
        this.dispatch("[native]");
      } else {
        this.dispatch(fn.toString());
      }
    }
    number(number) {
      return this.write("number:" + number);
    }
    null() {
      return this.write("Null");
    }
    undefined() {
      return this.write("Undefined");
    }
    regexp(regex) {
      return this.write("regex:" + regex.toString());
    }
    arraybuffer(arr) {
      this.write("arraybuffer:");
      return this.dispatch(new Uint8Array(arr));
    }
    url(url) {
      return this.write("url:" + url.toString());
    }
    map(map) {
      this.write("map:");
      const arr = [...map];
      return this.array(arr, false);
    }
    set(set) {
      this.write("set:");
      const arr = [...set];
      return this.array(arr, false);
    }
    bigint(number) {
      return this.write("bigint:" + number.toString());
    }
  }
  for (const type of [
    "uint8array",
    "uint8clampedarray",
    "unt8array",
    "uint16array",
    "unt16array",
    "uint32array",
    "unt32array",
    "float32array",
    "float64array"
  ]) {
    Hasher2.prototype[type] = function(arr) {
      this.write(type + ":");
      return this.array([...arr], false);
    };
  }
  function isNativeFunction(f) {
    if (typeof f !== "function") {
      return false;
    }
    return Function.prototype.toString.call(f).slice(
      -15
      /* "[native code] }".length */
    ) === "[native code] }";
  }
  return Hasher2;
})();
function serialize(object) {
  const hasher = new Hasher();
  hasher.dispatch(object);
  return hasher.buff;
}
function hash(value) {
  return digest(typeof value === "string" ? value : serialize(value)).replace(/[-_]/g, "").slice(0, 10);
}

function defaultCacheOptions() {
  return {
    name: "_",
    base: "/cache",
    swr: true,
    maxAge: 1
  };
}
function defineCachedFunction(fn, opts = {}) {
  opts = { ...defaultCacheOptions(), ...opts };
  const pending = {};
  const group = opts.group || "nitro/functions";
  const name = opts.name || fn.name || "_";
  const integrity = opts.integrity || hash([fn, opts]);
  const validate = opts.validate || ((entry) => entry.value !== void 0);
  async function get(key, resolver, shouldInvalidateCache, event) {
    const cacheKey = [opts.base, group, name, key + ".json"].filter(Boolean).join(":").replace(/:\/$/, ":index");
    let entry = await useStorage().getItem(cacheKey).catch((error) => {
      console.error(`[cache] Cache read error.`, error);
      useNitroApp().captureError(error, { event, tags: ["cache"] });
    }) || {};
    if (typeof entry !== "object") {
      entry = {};
      const error = new Error("Malformed data read from cache.");
      console.error("[cache]", error);
      useNitroApp().captureError(error, { event, tags: ["cache"] });
    }
    const ttl = (opts.maxAge ?? 0) * 1e3;
    if (ttl) {
      entry.expires = Date.now() + ttl;
    }
    const expired = shouldInvalidateCache || entry.integrity !== integrity || ttl && Date.now() - (entry.mtime || 0) > ttl || validate(entry) === false;
    const _resolve = async () => {
      const isPending = pending[key];
      if (!isPending) {
        if (entry.value !== void 0 && (opts.staleMaxAge || 0) >= 0 && opts.swr === false) {
          entry.value = void 0;
          entry.integrity = void 0;
          entry.mtime = void 0;
          entry.expires = void 0;
        }
        pending[key] = Promise.resolve(resolver());
      }
      try {
        entry.value = await pending[key];
      } catch (error) {
        if (!isPending) {
          delete pending[key];
        }
        throw error;
      }
      if (!isPending) {
        entry.mtime = Date.now();
        entry.integrity = integrity;
        delete pending[key];
        if (validate(entry) !== false) {
          let setOpts;
          if (opts.maxAge && !opts.swr) {
            setOpts = { ttl: opts.maxAge };
          }
          const promise = useStorage().setItem(cacheKey, entry, setOpts).catch((error) => {
            console.error(`[cache] Cache write error.`, error);
            useNitroApp().captureError(error, { event, tags: ["cache"] });
          });
          if (event?.waitUntil) {
            event.waitUntil(promise);
          }
        }
      }
    };
    const _resolvePromise = expired ? _resolve() : Promise.resolve();
    if (entry.value === void 0) {
      await _resolvePromise;
    } else if (expired && event && event.waitUntil) {
      event.waitUntil(_resolvePromise);
    }
    if (opts.swr && validate(entry) !== false) {
      _resolvePromise.catch((error) => {
        console.error(`[cache] SWR handler error.`, error);
        useNitroApp().captureError(error, { event, tags: ["cache"] });
      });
      return entry;
    }
    return _resolvePromise.then(() => entry);
  }
  return async (...args) => {
    const shouldBypassCache = await opts.shouldBypassCache?.(...args);
    if (shouldBypassCache) {
      return fn(...args);
    }
    const key = await (opts.getKey || getKey)(...args);
    const shouldInvalidateCache = await opts.shouldInvalidateCache?.(...args);
    const entry = await get(
      key,
      () => fn(...args),
      shouldInvalidateCache,
      args[0] && isEvent(args[0]) ? args[0] : void 0
    );
    let value = entry.value;
    if (opts.transform) {
      value = await opts.transform(entry, ...args) || value;
    }
    return value;
  };
}
function cachedFunction(fn, opts = {}) {
  return defineCachedFunction(fn, opts);
}
function getKey(...args) {
  return args.length > 0 ? hash(args) : "";
}
function escapeKey(key) {
  return String(key).replace(/\W/g, "");
}
function defineCachedEventHandler(handler, opts = defaultCacheOptions()) {
  const variableHeaderNames = (opts.varies || []).filter(Boolean).map((h) => h.toLowerCase()).sort();
  const _opts = {
    ...opts,
    getKey: async (event) => {
      const customKey = await opts.getKey?.(event);
      if (customKey) {
        return escapeKey(customKey);
      }
      const _path = event.node.req.originalUrl || event.node.req.url || event.path;
      let _pathname;
      try {
        _pathname = escapeKey(decodeURI(parseURL(_path).pathname)).slice(0, 16) || "index";
      } catch {
        _pathname = "-";
      }
      const _hashedPath = `${_pathname}.${hash(_path)}`;
      const _headers = variableHeaderNames.map((header) => [header, event.node.req.headers[header]]).map(([name, value]) => `${escapeKey(name)}.${hash(value)}`);
      return [_hashedPath, ..._headers].join(":");
    },
    validate: (entry) => {
      if (!entry.value) {
        return false;
      }
      if (entry.value.code >= 400) {
        return false;
      }
      if (entry.value.body === void 0) {
        return false;
      }
      if (entry.value.headers.etag === "undefined" || entry.value.headers["last-modified"] === "undefined") {
        return false;
      }
      return true;
    },
    group: opts.group || "nitro/handlers",
    integrity: opts.integrity || hash([handler, opts])
  };
  const _cachedHandler = cachedFunction(
    async (incomingEvent) => {
      const variableHeaders = {};
      for (const header of variableHeaderNames) {
        const value = incomingEvent.node.req.headers[header];
        if (value !== void 0) {
          variableHeaders[header] = value;
        }
      }
      const reqProxy = cloneWithProxy(incomingEvent.node.req, {
        headers: variableHeaders
      });
      const resHeaders = {};
      let _resSendBody;
      const resProxy = cloneWithProxy(incomingEvent.node.res, {
        statusCode: 200,
        writableEnded: false,
        writableFinished: false,
        headersSent: false,
        closed: false,
        getHeader(name) {
          return resHeaders[name];
        },
        setHeader(name, value) {
          resHeaders[name] = value;
          return this;
        },
        getHeaderNames() {
          return Object.keys(resHeaders);
        },
        hasHeader(name) {
          return name in resHeaders;
        },
        removeHeader(name) {
          delete resHeaders[name];
        },
        getHeaders() {
          return resHeaders;
        },
        end(chunk, arg2, arg3) {
          if (typeof chunk === "string") {
            _resSendBody = chunk;
          }
          if (typeof arg2 === "function") {
            arg2();
          }
          if (typeof arg3 === "function") {
            arg3();
          }
          return this;
        },
        write(chunk, arg2, arg3) {
          if (typeof chunk === "string") {
            _resSendBody = chunk;
          }
          if (typeof arg2 === "function") {
            arg2(void 0);
          }
          if (typeof arg3 === "function") {
            arg3();
          }
          return true;
        },
        writeHead(statusCode, headers2) {
          this.statusCode = statusCode;
          if (headers2) {
            if (Array.isArray(headers2) || typeof headers2 === "string") {
              throw new TypeError("Raw headers  is not supported.");
            }
            for (const header in headers2) {
              const value = headers2[header];
              if (value !== void 0) {
                this.setHeader(
                  header,
                  value
                );
              }
            }
          }
          return this;
        }
      });
      const event = createEvent(reqProxy, resProxy);
      event.fetch = (url, fetchOptions) => fetchWithEvent(event, url, fetchOptions, {
        fetch: useNitroApp().localFetch
      });
      event.$fetch = (url, fetchOptions) => fetchWithEvent(event, url, fetchOptions, {
        fetch: globalThis.$fetch
      });
      event.waitUntil = incomingEvent.waitUntil;
      event.context = incomingEvent.context;
      event.context.cache = {
        options: _opts
      };
      const body = await handler(event) || _resSendBody;
      const headers = event.node.res.getHeaders();
      headers.etag = String(
        headers.Etag || headers.etag || `W/"${hash(body)}"`
      );
      headers["last-modified"] = String(
        headers["Last-Modified"] || headers["last-modified"] || (/* @__PURE__ */ new Date()).toUTCString()
      );
      const cacheControl = [];
      if (opts.swr) {
        if (opts.maxAge) {
          cacheControl.push(`s-maxage=${opts.maxAge}`);
        }
        if (opts.staleMaxAge) {
          cacheControl.push(`stale-while-revalidate=${opts.staleMaxAge}`);
        } else {
          cacheControl.push("stale-while-revalidate");
        }
      } else if (opts.maxAge) {
        cacheControl.push(`max-age=${opts.maxAge}`);
      }
      if (cacheControl.length > 0) {
        headers["cache-control"] = cacheControl.join(", ");
      }
      const cacheEntry = {
        code: event.node.res.statusCode,
        headers,
        body
      };
      return cacheEntry;
    },
    _opts
  );
  return defineEventHandler(async (event) => {
    if (opts.headersOnly) {
      if (handleCacheHeaders(event, { maxAge: opts.maxAge })) {
        return;
      }
      return handler(event);
    }
    const response = await _cachedHandler(
      event
    );
    if (event.node.res.headersSent || event.node.res.writableEnded) {
      return response.body;
    }
    if (handleCacheHeaders(event, {
      modifiedTime: new Date(response.headers["last-modified"]),
      etag: response.headers.etag,
      maxAge: opts.maxAge
    })) {
      return;
    }
    event.node.res.statusCode = response.code;
    for (const name in response.headers) {
      const value = response.headers[name];
      if (name === "set-cookie") {
        event.node.res.appendHeader(
          name,
          splitCookiesString(value)
        );
      } else {
        if (value !== void 0) {
          event.node.res.setHeader(name, value);
        }
      }
    }
    return response.body;
  });
}
function cloneWithProxy(obj, overrides) {
  return new Proxy(obj, {
    get(target, property, receiver) {
      if (property in overrides) {
        return overrides[property];
      }
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (property in overrides) {
        overrides[property] = value;
        return true;
      }
      return Reflect.set(target, property, value, receiver);
    }
  });
}
const cachedEventHandler = defineCachedEventHandler;

const inlineAppConfig = {};



const appConfig$1 = defuFn(inlineAppConfig);

function getEnv(key, opts) {
  const envKey = snakeCase(key).toUpperCase();
  return destr(
    process.env[opts.prefix + envKey] ?? process.env[opts.altPrefix + envKey]
  );
}
function _isObject(input) {
  return typeof input === "object" && !Array.isArray(input);
}
function applyEnv(obj, opts, parentKey = "") {
  for (const key in obj) {
    const subKey = parentKey ? `${parentKey}_${key}` : key;
    const envValue = getEnv(subKey, opts);
    if (_isObject(obj[key])) {
      if (_isObject(envValue)) {
        obj[key] = { ...obj[key], ...envValue };
        applyEnv(obj[key], opts, subKey);
      } else if (envValue === void 0) {
        applyEnv(obj[key], opts, subKey);
      } else {
        obj[key] = envValue ?? obj[key];
      }
    } else {
      obj[key] = envValue ?? obj[key];
    }
    if (opts.envExpansion && typeof obj[key] === "string") {
      obj[key] = _expandFromEnv(obj[key]);
    }
  }
  return obj;
}
const envExpandRx = /\{\{([^{}]*)\}\}/g;
function _expandFromEnv(value) {
  return value.replace(envExpandRx, (match, key) => {
    return process.env[key] || match;
  });
}

const _inlineRuntimeConfig = {
  "app": {
    "baseURL": "/"
  },
  "nitro": {
    "routeRules": {
      "/_build/assets/**": {
        "headers": {
          "cache-control": "public, immutable, max-age=31536000"
        }
      }
    }
  }
};
const envOptions = {
  prefix: "NITRO_",
  altPrefix: _inlineRuntimeConfig.nitro.envPrefix ?? process.env.NITRO_ENV_PREFIX ?? "_",
  envExpansion: _inlineRuntimeConfig.nitro.envExpansion ?? process.env.NITRO_ENV_EXPANSION ?? false
};
const _sharedRuntimeConfig = _deepFreeze(
  applyEnv(klona(_inlineRuntimeConfig), envOptions)
);
function useRuntimeConfig(event) {
  {
    return _sharedRuntimeConfig;
  }
}
_deepFreeze(klona(appConfig$1));
function _deepFreeze(object) {
  const propNames = Object.getOwnPropertyNames(object);
  for (const name of propNames) {
    const value = object[name];
    if (value && typeof value === "object") {
      _deepFreeze(value);
    }
  }
  return Object.freeze(object);
}
new Proxy(/* @__PURE__ */ Object.create(null), {
  get: (_, prop) => {
    console.warn(
      "Please use `useRuntimeConfig()` instead of accessing config directly."
    );
    const runtimeConfig = useRuntimeConfig();
    if (prop in runtimeConfig) {
      return runtimeConfig[prop];
    }
    return void 0;
  }
});

const nitroAsyncContext = getContext("nitro-app", {
  asyncContext: true,
  AsyncLocalStorage: AsyncLocalStorage 
});

function isPathInScope(pathname, base) {
  let canonical;
  try {
    const pre = pathname.replace(/%2f/gi, "/").replace(/%5c/gi, "\\");
    canonical = new URL(pre, "http://_").pathname;
  } catch {
    return false;
  }
  return !base || canonical === base || canonical.startsWith(base + "/");
}

const config = useRuntimeConfig();
const _routeRulesMatcher = toRouteMatcher(
  createRouter({ routes: config.nitro.routeRules })
);
function createRouteRulesHandler(ctx) {
  return eventHandler((event) => {
    const routeRules = getRouteRules(event);
    if (routeRules.headers) {
      setHeaders(event, routeRules.headers);
    }
    if (routeRules.redirect) {
      let target = routeRules.redirect.to;
      if (target.endsWith("/**")) {
        let targetPath = event.path;
        const strpBase = routeRules.redirect._redirectStripBase;
        if (strpBase) {
          if (!isPathInScope(event.path.split("?")[0], strpBase)) {
            throw createError({ statusCode: 400 });
          }
          targetPath = withoutBase(targetPath, strpBase);
        } else if (targetPath.startsWith("//")) {
          targetPath = targetPath.replace(/^\/+/, "/");
        }
        target = joinURL(target.slice(0, -3), targetPath);
      } else if (event.path.includes("?")) {
        const query = getQuery(event.path);
        target = withQuery(target, query);
      }
      return sendRedirect(event, target, routeRules.redirect.statusCode);
    }
    if (routeRules.proxy) {
      let target = routeRules.proxy.to;
      if (target.endsWith("/**")) {
        let targetPath = event.path;
        const strpBase = routeRules.proxy._proxyStripBase;
        if (strpBase) {
          if (!isPathInScope(event.path.split("?")[0], strpBase)) {
            throw createError({ statusCode: 400 });
          }
          targetPath = withoutBase(targetPath, strpBase);
        } else if (targetPath.startsWith("//")) {
          targetPath = targetPath.replace(/^\/+/, "/");
        }
        target = joinURL(target.slice(0, -3), targetPath);
      } else if (event.path.includes("?")) {
        const query = getQuery(event.path);
        target = withQuery(target, query);
      }
      return proxyRequest(event, target, {
        fetch: ctx.localFetch,
        ...routeRules.proxy
      });
    }
  });
}
function getRouteRules(event) {
  event.context._nitro = event.context._nitro || {};
  if (!event.context._nitro.routeRules) {
    event.context._nitro.routeRules = getRouteRulesForPath(
      withoutBase(event.path.split("?")[0], useRuntimeConfig().app.baseURL)
    );
  }
  return event.context._nitro.routeRules;
}
function getRouteRulesForPath(path) {
  return defu({}, ..._routeRulesMatcher.matchAll(path).reverse());
}

function _captureError(error, type) {
  console.error(`[${type}]`, error);
  useNitroApp().captureError(error, { tags: [type] });
}
function trapUnhandledNodeErrors() {
  process.on(
    "unhandledRejection",
    (error) => _captureError(error, "unhandledRejection")
  );
  process.on(
    "uncaughtException",
    (error) => _captureError(error, "uncaughtException")
  );
}
function joinHeaders(value) {
  return Array.isArray(value) ? value.join(", ") : String(value);
}
function normalizeFetchResponse(response) {
  if (!response.headers.has("set-cookie")) {
    return response;
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: normalizeCookieHeaders(response.headers)
  });
}
function normalizeCookieHeader(header = "") {
  return splitCookiesString(joinHeaders(header));
}
function normalizeCookieHeaders(headers) {
  const outgoingHeaders = new Headers();
  for (const [name, header] of headers) {
    if (name === "set-cookie") {
      for (const cookie of normalizeCookieHeader(header)) {
        outgoingHeaders.append("set-cookie", cookie);
      }
    } else {
      outgoingHeaders.set(name, joinHeaders(header));
    }
  }
  return outgoingHeaders;
}

function defineNitroErrorHandler(handler) {
  return handler;
}

const errorHandler$0 = defineNitroErrorHandler(
  function defaultNitroErrorHandler(error, event) {
    const res = defaultHandler(error, event);
    setResponseHeaders(event, res.headers);
    setResponseStatus(event, res.status, res.statusText);
    return send(event, JSON.stringify(res.body, null, 2));
  }
);
function defaultHandler(error, event, opts) {
  const isSensitive = error.unhandled || error.fatal;
  const statusCode = error.statusCode || 500;
  const statusMessage = error.statusMessage || "Server Error";
  const url = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true });
  if (statusCode === 404) {
    const baseURL = "/";
    if (/^\/[^/]/.test(baseURL) && !url.pathname.startsWith(baseURL)) {
      const redirectTo = `${baseURL}${url.pathname.slice(1)}${url.search}`;
      return {
        status: 302,
        statusText: "Found",
        headers: { location: redirectTo },
        body: `Redirecting...`
      };
    }
  }
  if (isSensitive && !opts?.silent) {
    const tags = [error.unhandled && "[unhandled]", error.fatal && "[fatal]"].filter(Boolean).join(" ");
    console.error(`[request error] ${tags} [${event.method}] ${url}
`, error);
  }
  const headers = {
    "content-type": "application/json",
    // Prevent browser from guessing the MIME types of resources.
    "x-content-type-options": "nosniff",
    // Prevent error page from being embedded in an iframe
    "x-frame-options": "DENY",
    // Prevent browsers from sending the Referer header
    "referrer-policy": "no-referrer",
    // Disable the execution of any js
    "content-security-policy": "script-src 'none'; frame-ancestors 'none';"
  };
  setResponseStatus(event, statusCode, statusMessage);
  if (statusCode === 404 || !getResponseHeader(event, "cache-control")) {
    headers["cache-control"] = "no-cache";
  }
  const body = {
    error: true,
    url: url.href,
    statusCode,
    statusMessage,
    message: isSensitive ? "Server Error" : error.message,
    data: isSensitive ? void 0 : error.data
  };
  return {
    status: statusCode,
    statusText: statusMessage,
    headers,
    body
  };
}

const errorHandlers = [errorHandler$0];

async function errorHandler(error, event) {
  for (const handler of errorHandlers) {
    try {
      await handler(error, event, { defaultHandler });
      if (event.handled) {
        return; // Response handled
      }
    } catch(error) {
      // Handler itself thrown, log and continue
      console.error(error);
    }
  }
  // H3 will handle fallback
}

const appConfig = {"name":"vinxi","routers":[{"name":"public","type":"static","base":"/","dir":"./public","root":"/website","order":0,"outDir":"/website/.vinxi/build/public"},{"name":"ssr","type":"http","link":{"client":"client"},"handler":"src/entry-server.tsx","extensions":["js","jsx","ts","tsx"],"target":"server","root":"/website","base":"/","outDir":"/website/.vinxi/build/ssr","order":1},{"name":"client","type":"client","base":"/_build","handler":"src/entry-client.tsx","extensions":["js","jsx","ts","tsx"],"target":"browser","root":"/website","outDir":"/website/.vinxi/build/client","order":2},{"name":"server-fns","type":"http","base":"/_server","handler":"node_modules/@solidjs/start/dist/runtime/server-handler.js","target":"server","root":"/website","outDir":"/website/.vinxi/build/server-fns","order":3}],"server":{"compressPublicAssets":{"brotli":true},"routeRules":{"/_build/assets/**":{"headers":{"cache-control":"public, immutable, max-age=31536000"}}},"experimental":{"asyncContext":true},"preset":"static","prerender":{"crawlLinks":false}},"root":"/website"};
					const buildManifest = {"ssr":{"_index-BgYMpQL1.js":{"file":"assets/index-BgYMpQL1.js","name":"index"},"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-wght-normal.woff2":{"file":"assets/bricolage-grotesque-latin-ext-wght-normal-CcLUaPy7.woff2","src":"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-wght-normal.woff2"},"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2":{"file":"assets/bricolage-grotesque-latin-wght-normal-DLoelf7F.woff2","src":"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2"},"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-vietnamese-wght-normal.woff2":{"file":"assets/bricolage-grotesque-vietnamese-wght-normal-BUzh504Q.woff2","src":"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-vietnamese-wght-normal.woff2"},"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-cyrillic-wght-normal.woff2":{"file":"assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2","src":"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-cyrillic-wght-normal.woff2"},"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-greek-wght-normal.woff2":{"file":"assets/jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2","src":"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-greek-wght-normal.woff2"},"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2":{"file":"assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2","src":"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2"},"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2":{"file":"assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2","src":"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2"},"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-vietnamese-wght-normal.woff2":{"file":"assets/jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2","src":"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-vietnamese-wght-normal.woff2"},"src/routes/index.tsx?pick=default&pick=$css":{"file":"index.js","name":"index","src":"src/routes/index.tsx?pick=default&pick=$css","isEntry":true,"isDynamicEntry":true,"imports":["_index-BgYMpQL1.js"]},"virtual:$vinxi/handler/ssr":{"file":"ssr.js","name":"ssr","src":"virtual:$vinxi/handler/ssr","isEntry":true,"imports":["_index-BgYMpQL1.js"],"dynamicImports":["src/routes/index.tsx?pick=default&pick=$css","src/routes/index.tsx?pick=default&pick=$css"],"css":["assets/ssr-YfgcMi66.css"],"assets":["assets/bricolage-grotesque-vietnamese-wght-normal-BUzh504Q.woff2","assets/bricolage-grotesque-latin-ext-wght-normal-CcLUaPy7.woff2","assets/bricolage-grotesque-latin-wght-normal-DLoelf7F.woff2","assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2","assets/jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2","assets/jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2","assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2","assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2"]}},"client":{"_index-DiHXsjeo.js":{"file":"assets/index-DiHXsjeo.js","name":"index"},"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-wght-normal.woff2":{"file":"assets/bricolage-grotesque-latin-ext-wght-normal-CcLUaPy7.woff2","src":"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-wght-normal.woff2"},"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2":{"file":"assets/bricolage-grotesque-latin-wght-normal-DLoelf7F.woff2","src":"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2"},"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-vietnamese-wght-normal.woff2":{"file":"assets/bricolage-grotesque-vietnamese-wght-normal-BUzh504Q.woff2","src":"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-vietnamese-wght-normal.woff2"},"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-cyrillic-wght-normal.woff2":{"file":"assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2","src":"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-cyrillic-wght-normal.woff2"},"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-greek-wght-normal.woff2":{"file":"assets/jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2","src":"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-greek-wght-normal.woff2"},"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2":{"file":"assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2","src":"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2"},"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2":{"file":"assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2","src":"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2"},"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-vietnamese-wght-normal.woff2":{"file":"assets/jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2","src":"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-vietnamese-wght-normal.woff2"},"src/routes/index.tsx?pick=default&pick=$css":{"file":"assets/index-rHZk7WcE.js","name":"index","src":"src/routes/index.tsx?pick=default&pick=$css","isEntry":true,"isDynamicEntry":true,"imports":["_index-DiHXsjeo.js"]},"virtual:$vinxi/handler/client":{"file":"assets/client-S3MyayNc.js","name":"client","src":"virtual:$vinxi/handler/client","isEntry":true,"imports":["_index-DiHXsjeo.js"],"dynamicImports":["src/routes/index.tsx?pick=default&pick=$css"],"css":["assets/client-YfgcMi66.css"],"assets":["assets/bricolage-grotesque-vietnamese-wght-normal-BUzh504Q.woff2","assets/bricolage-grotesque-latin-ext-wght-normal-CcLUaPy7.woff2","assets/bricolage-grotesque-latin-wght-normal-DLoelf7F.woff2","assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2","assets/jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2","assets/jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2","assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2","assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2"]}},"server-fns":{"_index-BgYMpQL1.js":{"file":"assets/index-BgYMpQL1.js","name":"index"},"_server-fns-BsHZJAsV.js":{"file":"assets/server-fns-BsHZJAsV.js","name":"server-fns","dynamicImports":["src/routes/index.tsx?pick=default&pick=$css","src/routes/index.tsx?pick=default&pick=$css","src/app.tsx"]},"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-wght-normal.woff2":{"file":"assets/bricolage-grotesque-latin-ext-wght-normal-CcLUaPy7.woff2","src":"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-wght-normal.woff2"},"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2":{"file":"assets/bricolage-grotesque-latin-wght-normal-DLoelf7F.woff2","src":"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2"},"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-vietnamese-wght-normal.woff2":{"file":"assets/bricolage-grotesque-vietnamese-wght-normal-BUzh504Q.woff2","src":"node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-vietnamese-wght-normal.woff2"},"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-cyrillic-wght-normal.woff2":{"file":"assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2","src":"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-cyrillic-wght-normal.woff2"},"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-greek-wght-normal.woff2":{"file":"assets/jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2","src":"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-greek-wght-normal.woff2"},"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2":{"file":"assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2","src":"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2"},"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2":{"file":"assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2","src":"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2"},"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-vietnamese-wght-normal.woff2":{"file":"assets/jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2","src":"node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-vietnamese-wght-normal.woff2"},"src/app.tsx":{"file":"assets/app-B_kODm4M.js","name":"app","src":"src/app.tsx","isDynamicEntry":true,"imports":["_index-BgYMpQL1.js","_server-fns-BsHZJAsV.js"],"css":["assets/app-DOgIynJI.css"],"assets":["assets/bricolage-grotesque-vietnamese-wght-normal-BUzh504Q.woff2","assets/bricolage-grotesque-latin-ext-wght-normal-CcLUaPy7.woff2","assets/bricolage-grotesque-latin-wght-normal-DLoelf7F.woff2","assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2","assets/jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2","assets/jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2","assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2","assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2"]},"src/routes/index.tsx?pick=default&pick=$css":{"file":"index.js","name":"index","src":"src/routes/index.tsx?pick=default&pick=$css","isEntry":true,"isDynamicEntry":true,"imports":["_index-BgYMpQL1.js"]},"virtual:$vinxi/handler/server-fns":{"file":"server-fns.js","name":"server-fns","src":"virtual:$vinxi/handler/server-fns","isEntry":true,"imports":["_server-fns-BsHZJAsV.js"]}}};

					const routeManifest = {"ssr":{},"client":{},"server-fns":{}};

        function createProdApp(appConfig) {
          return {
            config: { ...appConfig, buildManifest, routeManifest },
            getRouter(name) {
              return appConfig.routers.find(router => router.name === name)
            }
          }
        }

        function plugin(app) {
          const prodApp = createProdApp(appConfig);
          globalThis.app = prodApp;
        }

const chunks = {};
			 



			 function app() {
				 globalThis.$$chunks = chunks;
			 }

const plugins = [
  plugin,
_I4HpcBBewrbnT_2vqisqiEhxD98fOTOBiAJRFbQCLFI,
_DzwTVQiPxK427aLiDEPF5bke2RvTs4IQKtJObZJ404,
app
];

const assets = {
  "/brand/favicon.svg": {
    "type": "image/svg+xml",
    "etag": "\"255-kGs9nAT7xXcvivufFgJtOt7V6DA\"",
    "mtime": "2026-05-16T09:18:49.692Z",
    "size": 597,
    "path": "../../.output/public/brand/favicon.svg"
  },
  "/brand/inkdrop.svg": {
    "type": "image/svg+xml",
    "etag": "\"280-Tctbjk/ENDGzs2C/ErDfVTocCW4\"",
    "mtime": "2026-05-16T09:18:49.692Z",
    "size": 640,
    "path": "../../.output/public/brand/inkdrop.svg"
  },
  "/brand/geometric.svg": {
    "type": "image/svg+xml",
    "etag": "\"26e-cOHQ1+rfc576a8L1zNgOAcATAT0\"",
    "mtime": "2026-05-16T09:18:49.692Z",
    "size": 622,
    "path": "../../.output/public/brand/geometric.svg"
  },
  "/assets/bricolage-grotesque-latin-ext-wght-normal-CcLUaPy7.woff2": {
    "type": "font/woff2",
    "etag": "\"48ec-mL6H9kspxYHhyP85eG93vIxKRJI\"",
    "mtime": "2026-05-16T09:18:49.693Z",
    "size": 18668,
    "path": "../../.output/public/assets/bricolage-grotesque-latin-ext-wght-normal-CcLUaPy7.woff2"
  },
  "/assets/bricolage-grotesque-latin-wght-normal-DLoelf7F.woff2": {
    "type": "font/woff2",
    "etag": "\"a180-mwP5/+0FoCUlVDqMGMRbxwMsdys\"",
    "mtime": "2026-05-16T09:18:49.693Z",
    "size": 41344,
    "path": "../../.output/public/assets/bricolage-grotesque-latin-wght-normal-DLoelf7F.woff2"
  },
  "/assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2": {
    "type": "font/woff2",
    "etag": "\"2f4c-WiAGfn140d4QND3ayQWaCHF8rbE\"",
    "mtime": "2026-05-16T09:18:49.693Z",
    "size": 12108,
    "path": "../../.output/public/assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2"
  },
  "/assets/bricolage-grotesque-vietnamese-wght-normal-BUzh504Q.woff2": {
    "type": "font/woff2",
    "etag": "\"21a0-//RvG6IMzMKowFwlEzT7UTmJO9E\"",
    "mtime": "2026-05-16T09:18:49.693Z",
    "size": 8608,
    "path": "../../.output/public/assets/bricolage-grotesque-vietnamese-wght-normal-BUzh504Q.woff2"
  },
  "/assets/jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2": {
    "type": "font/woff2",
    "etag": "\"232c-Dnz9DhH4c266e6TziU1pxRkV6FY\"",
    "mtime": "2026-05-16T09:18:49.693Z",
    "size": 9004,
    "path": "../../.output/public/assets/jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2"
  },
  "/assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2": {
    "type": "font/woff2",
    "etag": "\"3b5c-HLF7Wvs2Z1IA1cPRs6jnor8OUQ4\"",
    "mtime": "2026-05-16T09:18:49.693Z",
    "size": 15196,
    "path": "../../.output/public/assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2"
  },
  "/assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2": {
    "type": "font/woff2",
    "etag": "\"9dd4-5yd+cUUhzrXxdMyYebUeD0qml1M\"",
    "mtime": "2026-05-16T09:18:49.693Z",
    "size": 40404,
    "path": "../../.output/public/assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2"
  },
  "/assets/jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2": {
    "type": "font/woff2",
    "etag": "\"1d50-/Re0MyD6BV8h81wBPVijGZH5GBs\"",
    "mtime": "2026-05-16T09:18:49.693Z",
    "size": 7504,
    "path": "../../.output/public/assets/jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2"
  },
  "/assets/ssr-YfgcMi66.css": {
    "type": "text/css; charset=utf-8",
    "encoding": null,
    "etag": "\"5dee-vWOx0OI9ySEk7DsBX6r/0TGMnmQ\"",
    "mtime": "2026-05-16T09:18:49.693Z",
    "size": 24046,
    "path": "../../.output/public/assets/ssr-YfgcMi66.css"
  },
  "/assets/ssr-YfgcMi66.css.gz": {
    "type": "text/css; charset=utf-8",
    "encoding": "gzip",
    "etag": "\"1ca8-RVN7U3yD18QD3FXWE7NpFs8X69c\"",
    "mtime": "2026-05-16T09:18:49.706Z",
    "size": 7336,
    "path": "../../.output/public/assets/ssr-YfgcMi66.css.gz"
  },
  "/assets/ssr-YfgcMi66.css.br": {
    "type": "text/css; charset=utf-8",
    "encoding": "br",
    "etag": "\"192e-ho8oHHynuwQEC/AsTSGj2eEAfaA\"",
    "mtime": "2026-05-16T09:18:49.718Z",
    "size": 6446,
    "path": "../../.output/public/assets/ssr-YfgcMi66.css.br"
  },
  "/_server/assets/app-DOgIynJI.css.gz": {
    "type": "text/css; charset=utf-8",
    "encoding": "gzip",
    "etag": "\"1ca9-TD+cX57CqZMiz4LfEPG/1qjAC2Q\"",
    "mtime": "2026-05-16T09:18:49.706Z",
    "size": 7337,
    "path": "../../.output/public/_server/assets/app-DOgIynJI.css.gz"
  },
  "/_server/assets/app-DOgIynJI.css": {
    "type": "text/css; charset=utf-8",
    "encoding": null,
    "etag": "\"5df6-1uqtVFa+MViBQ6gVmUCh/Dvxg24\"",
    "mtime": "2026-05-16T09:18:49.696Z",
    "size": 24054,
    "path": "../../.output/public/_server/assets/app-DOgIynJI.css"
  },
  "/_server/assets/app-DOgIynJI.css.br": {
    "type": "text/css; charset=utf-8",
    "encoding": "br",
    "etag": "\"192c-2zQZM4qGi6Q+EhMQSIN2VZedMU0\"",
    "mtime": "2026-05-16T09:18:49.730Z",
    "size": 6444,
    "path": "../../.output/public/_server/assets/app-DOgIynJI.css.br"
  },
  "/_server/assets/bricolage-grotesque-latin-ext-wght-normal-CcLUaPy7.woff2": {
    "type": "font/woff2",
    "etag": "\"48ec-mL6H9kspxYHhyP85eG93vIxKRJI\"",
    "mtime": "2026-05-16T09:18:49.696Z",
    "size": 18668,
    "path": "../../.output/public/_server/assets/bricolage-grotesque-latin-ext-wght-normal-CcLUaPy7.woff2"
  },
  "/_server/assets/bricolage-grotesque-vietnamese-wght-normal-BUzh504Q.woff2": {
    "type": "font/woff2",
    "etag": "\"21a0-//RvG6IMzMKowFwlEzT7UTmJO9E\"",
    "mtime": "2026-05-16T09:18:49.696Z",
    "size": 8608,
    "path": "../../.output/public/_server/assets/bricolage-grotesque-vietnamese-wght-normal-BUzh504Q.woff2"
  },
  "/_server/assets/jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2": {
    "type": "font/woff2",
    "etag": "\"232c-Dnz9DhH4c266e6TziU1pxRkV6FY\"",
    "mtime": "2026-05-16T09:18:49.696Z",
    "size": 9004,
    "path": "../../.output/public/_server/assets/jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2"
  },
  "/_server/assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2": {
    "type": "font/woff2",
    "etag": "\"2f4c-WiAGfn140d4QND3ayQWaCHF8rbE\"",
    "mtime": "2026-05-16T09:18:49.696Z",
    "size": 12108,
    "path": "../../.output/public/_server/assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2"
  },
  "/_server/assets/bricolage-grotesque-latin-wght-normal-DLoelf7F.woff2": {
    "type": "font/woff2",
    "etag": "\"a180-mwP5/+0FoCUlVDqMGMRbxwMsdys\"",
    "mtime": "2026-05-16T09:18:49.696Z",
    "size": 41344,
    "path": "../../.output/public/_server/assets/bricolage-grotesque-latin-wght-normal-DLoelf7F.woff2"
  },
  "/_server/assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2": {
    "type": "font/woff2",
    "etag": "\"3b5c-HLF7Wvs2Z1IA1cPRs6jnor8OUQ4\"",
    "mtime": "2026-05-16T09:18:49.696Z",
    "size": 15196,
    "path": "../../.output/public/_server/assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2"
  },
  "/_server/assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2": {
    "type": "font/woff2",
    "etag": "\"9dd4-5yd+cUUhzrXxdMyYebUeD0qml1M\"",
    "mtime": "2026-05-16T09:18:49.696Z",
    "size": 40404,
    "path": "../../.output/public/_server/assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2"
  },
  "/_server/assets/jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2": {
    "type": "font/woff2",
    "etag": "\"1d50-/Re0MyD6BV8h81wBPVijGZH5GBs\"",
    "mtime": "2026-05-16T09:18:49.696Z",
    "size": 7504,
    "path": "../../.output/public/_server/assets/jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2"
  },
  "/_build/.vite/manifest.json": {
    "type": "application/json",
    "encoding": null,
    "etag": "\"e71-T/Ps0FccK+LFqvtYww/lqJpzb58\"",
    "mtime": "2026-05-16T09:18:49.695Z",
    "size": 3697,
    "path": "../../.output/public/_build/.vite/manifest.json"
  },
  "/_build/.vite/manifest.json.br": {
    "type": "application/json",
    "encoding": "br",
    "etag": "\"1f6-S+pMbksA3457cxhLiWh6732aUAg\"",
    "mtime": "2026-05-16T09:18:49.718Z",
    "size": 502,
    "path": "../../.output/public/_build/.vite/manifest.json.br"
  },
  "/_build/.vite/manifest.json.gz": {
    "type": "application/json",
    "encoding": "gzip",
    "etag": "\"232-pgSuL0YeTimO4J5dF/H7oWcuhfA\"",
    "mtime": "2026-05-16T09:18:49.718Z",
    "size": 562,
    "path": "../../.output/public/_build/.vite/manifest.json.gz"
  },
  "/_build/assets/bricolage-grotesque-latin-ext-wght-normal-CcLUaPy7.woff2": {
    "type": "font/woff2",
    "etag": "\"48ec-mL6H9kspxYHhyP85eG93vIxKRJI\"",
    "mtime": "2026-05-16T09:18:49.695Z",
    "size": 18668,
    "path": "../../.output/public/_build/assets/bricolage-grotesque-latin-ext-wght-normal-CcLUaPy7.woff2"
  },
  "/_build/assets/bricolage-grotesque-vietnamese-wght-normal-BUzh504Q.woff2": {
    "type": "font/woff2",
    "etag": "\"21a0-//RvG6IMzMKowFwlEzT7UTmJO9E\"",
    "mtime": "2026-05-16T09:18:49.695Z",
    "size": 8608,
    "path": "../../.output/public/_build/assets/bricolage-grotesque-vietnamese-wght-normal-BUzh504Q.woff2"
  },
  "/_build/assets/client-S3MyayNc.js": {
    "type": "text/javascript; charset=utf-8",
    "encoding": null,
    "etag": "\"528f-CGfntTO1C5b8AY8og3rDab6CBIM\"",
    "mtime": "2026-05-16T09:18:49.695Z",
    "size": 21135,
    "path": "../../.output/public/_build/assets/client-S3MyayNc.js"
  },
  "/_build/assets/bricolage-grotesque-latin-wght-normal-DLoelf7F.woff2": {
    "type": "font/woff2",
    "etag": "\"a180-mwP5/+0FoCUlVDqMGMRbxwMsdys\"",
    "mtime": "2026-05-16T09:18:49.695Z",
    "size": 41344,
    "path": "../../.output/public/_build/assets/bricolage-grotesque-latin-wght-normal-DLoelf7F.woff2"
  },
  "/_build/assets/client-S3MyayNc.js.br": {
    "type": "text/javascript; charset=utf-8",
    "encoding": "br",
    "etag": "\"1ed0-0XIG30v1TLHX9bg/4QigUh31KLc\"",
    "mtime": "2026-05-16T09:18:49.730Z",
    "size": 7888,
    "path": "../../.output/public/_build/assets/client-S3MyayNc.js.br"
  },
  "/_build/assets/client-S3MyayNc.js.gz": {
    "type": "text/javascript; charset=utf-8",
    "encoding": "gzip",
    "etag": "\"2233-9unYGnChOdjq9AgsJswpOmXJ4Iw\"",
    "mtime": "2026-05-16T09:18:49.718Z",
    "size": 8755,
    "path": "../../.output/public/_build/assets/client-S3MyayNc.js.gz"
  },
  "/_build/assets/client-YfgcMi66.css.br": {
    "type": "text/css; charset=utf-8",
    "encoding": "br",
    "etag": "\"192e-ho8oHHynuwQEC/AsTSGj2eEAfaA\"",
    "mtime": "2026-05-16T09:18:49.731Z",
    "size": 6446,
    "path": "../../.output/public/_build/assets/client-YfgcMi66.css.br"
  },
  "/_build/assets/client-YfgcMi66.css": {
    "type": "text/css; charset=utf-8",
    "encoding": null,
    "etag": "\"5dee-vWOx0OI9ySEk7DsBX6r/0TGMnmQ\"",
    "mtime": "2026-05-16T09:18:49.695Z",
    "size": 24046,
    "path": "../../.output/public/_build/assets/client-YfgcMi66.css"
  },
  "/_build/assets/client-YfgcMi66.css.gz": {
    "type": "text/css; charset=utf-8",
    "encoding": "gzip",
    "etag": "\"1ca8-RVN7U3yD18QD3FXWE7NpFs8X69c\"",
    "mtime": "2026-05-16T09:18:49.719Z",
    "size": 7336,
    "path": "../../.output/public/_build/assets/client-YfgcMi66.css.gz"
  },
  "/_build/assets/index-DiHXsjeo.js.br": {
    "type": "text/javascript; charset=utf-8",
    "encoding": "br",
    "etag": "\"2671-ZFg4WsBGaqLbgZbbL5feYk7DDoY\"",
    "mtime": "2026-05-16T09:18:49.739Z",
    "size": 9841,
    "path": "../../.output/public/_build/assets/index-DiHXsjeo.js.br"
  },
  "/_build/assets/index-DiHXsjeo.js": {
    "type": "text/javascript; charset=utf-8",
    "encoding": null,
    "etag": "\"6e15-tVW+bbCFO0rOX/5HR6i12kHUvK4\"",
    "mtime": "2026-05-16T09:18:49.695Z",
    "size": 28181,
    "path": "../../.output/public/_build/assets/index-DiHXsjeo.js"
  },
  "/_build/assets/index-DiHXsjeo.js.gz": {
    "type": "text/javascript; charset=utf-8",
    "encoding": "gzip",
    "etag": "\"2a4a-t7by41Iz3IXAIvG0GQI44e8jH9U\"",
    "mtime": "2026-05-16T09:18:49.730Z",
    "size": 10826,
    "path": "../../.output/public/_build/assets/index-DiHXsjeo.js.gz"
  },
  "/_build/assets/index-rHZk7WcE.js.br": {
    "type": "text/javascript; charset=utf-8",
    "encoding": "br",
    "etag": "\"1494-7WmRar31luCmswBE2WKo42zozHo\"",
    "mtime": "2026-05-16T09:18:49.735Z",
    "size": 5268,
    "path": "../../.output/public/_build/assets/index-rHZk7WcE.js.br"
  },
  "/_build/assets/index-rHZk7WcE.js": {
    "type": "text/javascript; charset=utf-8",
    "encoding": null,
    "etag": "\"4338-Tm8tf1iioc95bcyF0KP6FcLx16A\"",
    "mtime": "2026-05-16T09:18:49.695Z",
    "size": 17208,
    "path": "../../.output/public/_build/assets/index-rHZk7WcE.js"
  },
  "/_build/assets/index-rHZk7WcE.js.gz": {
    "type": "text/javascript; charset=utf-8",
    "encoding": "gzip",
    "etag": "\"184b-gAN2HCXDjKWpNw8lSvZtNayujJg\"",
    "mtime": "2026-05-16T09:18:49.730Z",
    "size": 6219,
    "path": "../../.output/public/_build/assets/index-rHZk7WcE.js.gz"
  },
  "/_build/assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2": {
    "type": "font/woff2",
    "etag": "\"2f4c-WiAGfn140d4QND3ayQWaCHF8rbE\"",
    "mtime": "2026-05-16T09:18:49.695Z",
    "size": 12108,
    "path": "../../.output/public/_build/assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2"
  },
  "/_build/assets/jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2": {
    "type": "font/woff2",
    "etag": "\"232c-Dnz9DhH4c266e6TziU1pxRkV6FY\"",
    "mtime": "2026-05-16T09:18:49.695Z",
    "size": 9004,
    "path": "../../.output/public/_build/assets/jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2"
  },
  "/_build/assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2": {
    "type": "font/woff2",
    "etag": "\"3b5c-HLF7Wvs2Z1IA1cPRs6jnor8OUQ4\"",
    "mtime": "2026-05-16T09:18:49.695Z",
    "size": 15196,
    "path": "../../.output/public/_build/assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2"
  },
  "/_build/assets/jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2": {
    "type": "font/woff2",
    "etag": "\"1d50-/Re0MyD6BV8h81wBPVijGZH5GBs\"",
    "mtime": "2026-05-16T09:18:49.695Z",
    "size": 7504,
    "path": "../../.output/public/_build/assets/jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2"
  },
  "/_build/assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2": {
    "type": "font/woff2",
    "etag": "\"9dd4-5yd+cUUhzrXxdMyYebUeD0qml1M\"",
    "mtime": "2026-05-16T09:18:49.695Z",
    "size": 40404,
    "path": "../../.output/public/_build/assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2"
  }
};

function readAsset (id) {
  const serverDir = dirname(fileURLToPath(globalThis._importMeta_.url));
  return promises.readFile(resolve(serverDir, assets[id].path))
}

const publicAssetBases = {};

function isPublicAssetURL(id = '') {
  if (assets[id]) {
    return true
  }
  for (const base in publicAssetBases) {
    if (id.startsWith(base)) { return true }
  }
  return false
}

function getAsset (id) {
  return assets[id]
}

const METHODS = /* @__PURE__ */ new Set(["HEAD", "GET"]);
const EncodingMap = { gzip: ".gz", br: ".br" };
const _PS91mO = eventHandler((event) => {
  if (event.method && !METHODS.has(event.method)) {
    return;
  }
  let id = decodePath(
    withLeadingSlash(withoutTrailingSlash(parseURL(event.path).pathname))
  );
  let asset;
  const encodingHeader = String(
    getRequestHeader(event, "accept-encoding") || ""
  );
  const encodings = [
    ...encodingHeader.split(",").map((e) => EncodingMap[e.trim()]).filter(Boolean).sort(),
    ""
  ];
  for (const encoding of encodings) {
    for (const _id of [id + encoding, joinURL(id, "index.html" + encoding)]) {
      const _asset = getAsset(_id);
      if (_asset) {
        asset = _asset;
        id = _id;
        break;
      }
    }
  }
  if (!asset) {
    if (isPublicAssetURL(id)) {
      removeResponseHeader(event, "Cache-Control");
      throw createError({ statusCode: 404 });
    }
    return;
  }
  if (asset.encoding !== void 0) {
    appendResponseHeader(event, "Vary", "Accept-Encoding");
  }
  const ifNotMatch = getRequestHeader(event, "if-none-match") === asset.etag;
  if (ifNotMatch) {
    setResponseStatus(event, 304, "Not Modified");
    return "";
  }
  const ifModifiedSinceH = getRequestHeader(event, "if-modified-since");
  const mtimeDate = new Date(asset.mtime);
  if (ifModifiedSinceH && asset.mtime && new Date(ifModifiedSinceH) >= mtimeDate) {
    setResponseStatus(event, 304, "Not Modified");
    return "";
  }
  if (asset.type && !getResponseHeader(event, "Content-Type")) {
    setResponseHeader(event, "Content-Type", asset.type);
  }
  if (asset.etag && !getResponseHeader(event, "ETag")) {
    setResponseHeader(event, "ETag", asset.etag);
  }
  if (asset.mtime && !getResponseHeader(event, "Last-Modified")) {
    setResponseHeader(event, "Last-Modified", mtimeDate.toUTCString());
  }
  if (asset.encoding && !getResponseHeader(event, "Content-Encoding")) {
    setResponseHeader(event, "Content-Encoding", asset.encoding);
  }
  if (asset.size > 0 && !getResponseHeader(event, "Content-Length")) {
    setResponseHeader(event, "Content-Length", asset.size);
  }
  return readAsset(id);
});

var __defProp$1 = Object.defineProperty;
var __defNormalProp$1 = (obj, key, value) => key in obj ? __defProp$1(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$1 = (obj, key, value) => __defNormalProp$1(obj, typeof key !== "symbol" ? key + "" : key, value);
function _e$1(e) {
  let n;
  const t = _(e), s = { duplex: "half", method: e.method, headers: e.headers };
  return e.node.req.body instanceof ArrayBuffer ? new Request(t, { ...s, body: e.node.req.body }) : new Request(t, { ...s, get body() {
    return n || (n = Ge(e), n);
  } });
}
function Ne(e) {
  var _a;
  return (_a = e.web) != null ? _a : e.web = { request: _e$1(e), url: _(e) }, e.web.request;
}
function Me() {
  return Qe();
}
const U = /* @__PURE__ */ Symbol("$HTTPEvent");
function je(e) {
  return typeof e == "object" && (e instanceof H3Event || (e == null ? void 0 : e[U]) instanceof H3Event || (e == null ? void 0 : e.__is_event__) === true);
}
function u(e) {
  return function(...n) {
    var _a;
    let t = n[0];
    if (je(t)) n[0] = t instanceof H3Event || t.__is_event__ ? t : t[U];
    else {
      if (!((_a = globalThis.app.config.server.experimental) == null ? void 0 : _a.asyncContext)) throw new Error("AsyncLocalStorage was not enabled. Use the `server.experimental.asyncContext: true` option in your app configuration to enable it. Or, pass the instance of HTTPEvent that you have as the first argument to the function.");
      if (t = Me(), !t) throw new Error("No HTTPEvent found in AsyncLocalStorage. Make sure you are using the function within the server runtime.");
      n.unshift(t);
    }
    return e(...n);
  };
}
const _ = u(getRequestURL$1), De = u(getRequestIP), S$2 = u(setResponseStatus$1), q = u(getResponseStatus), We = u(getResponseStatusText), y$1 = u(getResponseHeaders), H$2 = u(getResponseHeader$1), Be = u(setResponseHeader$1), N$1 = u(appendResponseHeader$1), ze = u(parseCookies), Je = u(getCookie), Xe = u(setCookie), h = u(setHeader), Ge = u(getRequestWebStream), Ke = u(removeResponseHeader$1), Ve = u(Ne);
function Ze() {
  var _a;
  return getContext("nitro-app", { asyncContext: !!((_a = globalThis.app.config.server.experimental) == null ? void 0 : _a.asyncContext), AsyncLocalStorage: AsyncLocalStorage });
}
function Qe() {
  return Ze().use().event;
}
const b = "Invariant Violation", { setPrototypeOf: Ye = function(e, n) {
  return e.__proto__ = n, e;
} } = Object;
class x extends Error {
  constructor(n = b) {
    super(typeof n == "number" ? `${b}: ${n} (see https://github.com/apollographql/invariant-packages)` : n);
    __publicField$1(this, "framesToPop", 1);
    __publicField$1(this, "name", b);
    Ye(this, x.prototype);
  }
}
function et(e, n) {
  if (!e) throw new x(n);
}
const v$1 = "solidFetchEvent";
function tt(e) {
  return { request: Ve(e), response: ot(e), clientAddress: De(e), locals: {}, nativeEvent: e };
}
function nt(e) {
  return { ...e };
}
function rt(e) {
  if (!e.context[v$1]) {
    const n = tt(e);
    e.context[v$1] = n;
  }
  return e.context[v$1];
}
function A$1(e, n) {
  for (const [t, s] of n.entries()) N$1(e, t, s);
}
class st {
  constructor(n) {
    __publicField$1(this, "event");
    this.event = n;
  }
  get(n) {
    const t = H$2(this.event, n);
    return Array.isArray(t) ? t.join(", ") : t || null;
  }
  has(n) {
    return this.get(n) !== null;
  }
  set(n, t) {
    return Be(this.event, n, t);
  }
  delete(n) {
    return Ke(this.event, n);
  }
  append(n, t) {
    N$1(this.event, n, t);
  }
  getSetCookie() {
    const n = H$2(this.event, "Set-Cookie");
    return Array.isArray(n) ? n : [n];
  }
  forEach(n) {
    return Object.entries(y$1(this.event)).forEach(([t, s]) => n(Array.isArray(s) ? s.join(", ") : s, t, this));
  }
  entries() {
    return Object.entries(y$1(this.event)).map(([n, t]) => [n, Array.isArray(t) ? t.join(", ") : t])[Symbol.iterator]();
  }
  keys() {
    return Object.keys(y$1(this.event))[Symbol.iterator]();
  }
  values() {
    return Object.values(y$1(this.event)).map((n) => Array.isArray(n) ? n.join(", ") : n)[Symbol.iterator]();
  }
  [Symbol.iterator]() {
    return this.entries()[Symbol.iterator]();
  }
}
function ot(e) {
  return { get status() {
    return q(e);
  }, set status(n) {
    S$2(e, n);
  }, get statusText() {
    return We(e);
  }, set statusText(n) {
    S$2(e, q(e), n);
  }, headers: new st(e) };
}
const M$1 = [{ page: true, $component: { src: "src/routes/index.tsx?pick=default&pick=$css", build: () => import('../build/index.mjs'), import: () => import('../build/index.mjs') }, path: "/", filePath: "/website/src/routes/index.tsx" }], at = it(M$1.filter((e) => e.page));
function it(e) {
  function n(t, s, o, a) {
    const i = Object.values(t).find((c) => o.startsWith(c.id + "/"));
    return i ? (n(i.children || (i.children = []), s, o.slice(i.id.length)), t) : (t.push({ ...s, id: o, path: o.replace(/\([^)/]+\)/g, "").replace(/\/+/g, "/") }), t);
  }
  return e.sort((t, s) => t.path.length - s.path.length).reduce((t, s) => n(t, s, s.path, s.path), []);
}
function ct(e) {
  return e.$HEAD || e.$GET || e.$POST || e.$PUT || e.$PATCH || e.$DELETE;
}
createRouter({ routes: M$1.reduce((e, n) => {
  if (!ct(n)) return e;
  let t = n.path.replace(/\([^)/]+\)/g, "").replace(/\/+/g, "/").replace(/\*([^/]*)/g, (s, o) => `**:${o}`).split("/").map((s) => s.startsWith(":") || s.startsWith("*") ? s : encodeURIComponent(s)).join("/");
  if (/:[^/]*\?/g.test(t)) throw new Error(`Optional parameters are not supported in API routes: ${t}`);
  if (e[t]) throw new Error(`Duplicate API routes for "${t}" found at "${e[t].route.path}" and "${n.path}"`);
  return e[t] = { route: n }, e;
}, {}) });
var lt = " ";
const dt = { style: (e) => ssrElement("style", e.attrs, () => e.children, true), link: (e) => ssrElement("link", e.attrs, void 0, true), script: (e) => e.attrs.src ? ssrElement("script", mergeProps(() => e.attrs, { get id() {
  return e.key;
} }), () => ssr(lt), true) : null, noscript: (e) => ssrElement("noscript", e.attrs, () => escape(e.children), true) };
function ft(e, n) {
  let { tag: t, attrs: { key: s, ...o } = { key: void 0 }, children: a } = e;
  return dt[t]({ attrs: { ...o, nonce: n }, key: s, children: a });
}
function pt(e, n, t, s = "default") {
  return lazy(async () => {
    var _a;
    {
      const a = (await e.import())[s], c = (await ((_a = n.inputs) == null ? void 0 : _a[e.src].assets())).filter((l) => l.tag === "style" || l.attrs.rel === "stylesheet");
      return { default: (l) => [...c.map((g) => ft(g)), createComponent(a, l)] };
    }
  });
}
function j() {
  function e(t) {
    return { ...t, ...t.$$route ? t.$$route.require().route : void 0, info: { ...t.$$route ? t.$$route.require().route.info : {}, filesystem: true }, component: t.$component && pt(t.$component, globalThis.MANIFEST.client, globalThis.MANIFEST.ssr), children: t.children ? t.children.map(e) : void 0 };
  }
  return at.map(e);
}
let C$1;
const Ft$1 = isServer ? () => getRequestEvent().routes : () => C$1 || (C$1 = j());
function ht(e) {
  const n = Je(e.nativeEvent, "flash");
  if (n) try {
    let t = JSON.parse(n);
    if (!t || !t.result) return;
    const s = [...t.input.slice(0, -1), new Map(t.input[t.input.length - 1])], o = t.error ? new Error(t.result) : t.result;
    return { input: s, url: t.url, pending: false, result: t.thrown ? void 0 : o, error: t.thrown ? o : void 0 };
  } catch (t) {
    console.error(t);
  } finally {
    Xe(e.nativeEvent, "flash", "", { maxAge: 0 });
  }
}
async function gt(e) {
  const n = globalThis.MANIFEST.client;
  return globalThis.MANIFEST.ssr, e.response.headers.set("Content-Type", "text/html"), Object.assign(e, { manifest: await n.json(), assets: [...await n.inputs[n.handler].assets()], router: { submission: ht(e) }, routes: j(), complete: false, $islands: /* @__PURE__ */ new Set() });
}
const mt = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
function Rt(e) {
  return e.status && mt.has(e.status) ? e.status : 302;
}
const yt = {}, E = [AbortSignalPlugin, CustomEventPlugin, DOMExceptionPlugin, EventPlugin, FormDataPlugin, HeadersPlugin, ReadableStreamPlugin, RequestPlugin, ResponsePlugin, URLSearchParamsPlugin, URLPlugin], St = 64, D = Feature.RegExp;
function W$1(e) {
  const n = new TextEncoder().encode(e), t = n.length, s = t.toString(16), o = "00000000".substring(0, 8 - s.length) + s, a = new TextEncoder().encode(`;0x${o};`), i = new Uint8Array(12 + t);
  return i.set(a), i.set(n, 12), i;
}
function k$1(e, n) {
  return new ReadableStream({ start(t) {
    crossSerializeStream(n, { scopeId: e, plugins: E, onSerialize(s, o) {
      t.enqueue(W$1(o ? `(${getCrossReferenceHeader(e)},${s})` : s));
    }, onDone() {
      t.close();
    }, onError(s) {
      t.error(s);
    } });
  } });
}
function wt(e) {
  return new ReadableStream({ start(n) {
    toCrossJSONStream(e, { disabledFeatures: D, depthLimit: St, plugins: E, onParse(t) {
      n.enqueue(W$1(JSON.stringify(t)));
    }, onDone() {
      n.close();
    }, onError(t) {
      n.error(t);
    } });
  } });
}
async function P(e) {
  return fromJSON(JSON.parse(e), { plugins: E, disabledFeatures: D });
}
async function bt(e) {
  const n = rt(e), t = n.request, s = t.headers.get("X-Server-Id"), o = t.headers.get("X-Server-Instance"), a = t.headers.has("X-Single-Flight"), i = new URL(t.url);
  let c, f;
  if (s) et(typeof s == "string", "Invalid server function"), [c, f] = decodeURIComponent(s).split("#");
  else if (c = i.searchParams.get("id"), f = i.searchParams.get("name"), !c || !f) return new Response(null, { status: 404 });
  const l = yt[c];
  let g;
  if (!l) return new Response(null, { status: 404 });
  g = await l.importer();
  const B = g[l.functionName];
  let p = [];
  if (!o || e.method === "GET") {
    const r = i.searchParams.get("args");
    if (r) {
      const d = await P(r);
      for (const m of d) p.push(m);
    }
  }
  if (e.method === "POST") {
    const r = t.headers.get("content-type"), d = e.node.req, m = d instanceof ReadableStream, z = d.body instanceof ReadableStream, J = m && d.locked || z && d.body.locked, X = m ? d : d.body, w = J ? t : new Request(t, { ...t, body: X });
    t.headers.get("x-serialized") ? p = await P(await w.text()) : (r == null ? void 0 : r.startsWith("multipart/form-data")) || (r == null ? void 0 : r.startsWith("application/x-www-form-urlencoded")) ? p.push(await w.formData()) : (r == null ? void 0 : r.startsWith("application/json")) && (p = await w.json());
  }
  try {
    let r = await provideRequestEvent(n, async () => (sharedConfig.context = { event: n }, n.locals.serverFunctionMeta = { id: c + "#" + f }, B(...p)));
    if (a && o && (r = await L(n, r)), r instanceof Response) {
      if (r.headers && r.headers.has("X-Content-Raw")) return r;
      o && (r.headers && A$1(e, r.headers), r.status && (r.status < 300 || r.status >= 400) && S$2(e, r.status), r.customBody ? r = await r.customBody() : r.body == null && (r = null));
    }
    if (!o) return F(r, t, p);
    return h(e, "x-serialized", "true"), h(e, "content-type", "text/javascript"), k$1(o, r);
    return wt(r);
  } catch (r) {
    if (r instanceof Response) a && o && (r = await L(n, r)), r.headers && A$1(e, r.headers), r.status && (!o || r.status < 300 || r.status >= 400) && S$2(e, r.status), r.customBody ? r = r.customBody() : r.body == null && (r = null), h(e, "X-Error", "true");
    else if (o) {
      const d = r instanceof Error ? r.message : typeof r == "string" ? r : "true";
      h(e, "X-Error", d.replace(/[\r\n]+/g, ""));
    } else r = F(r, t, p, true);
    return o ? (h(e, "x-serialized", "true"), h(e, "content-type", "text/javascript"), k$1(o, r)) : r;
  }
}
function F(e, n, t, s) {
  const o = new URL(n.url), a = e instanceof Error;
  let i = 302, c;
  return e instanceof Response ? (c = new Headers(e.headers), e.headers.has("Location") && (c.set("Location", new URL(e.headers.get("Location"), o.origin + "").toString()), i = Rt(e))) : c = new Headers({ Location: new URL(n.headers.get("referer")).toString() }), e && c.append("Set-Cookie", `flash=${encodeURIComponent(JSON.stringify({ url: o.pathname + o.search, result: a ? e.message : e, thrown: s, error: a, input: [...t.slice(0, -1), [...t[t.length - 1].entries()]] }))}; Secure; HttpOnly;`), new Response(null, { status: i, headers: c });
}
let $;
function vt(e) {
  var _a;
  const n = new Headers(e.request.headers), t = ze(e.nativeEvent), s = e.response.headers.getSetCookie();
  n.delete("cookie");
  let o = false;
  return ((_a = e.nativeEvent.node) == null ? void 0 : _a.req) && (o = true, e.nativeEvent.node.req.headers.cookie = ""), s.forEach((a) => {
    if (!a) return;
    const { maxAge: i, expires: c, name: f, value: l } = parseSetCookie(a);
    if (i != null && i <= 0) {
      delete t[f];
      return;
    }
    if (c != null && c.getTime() <= Date.now()) {
      delete t[f];
      return;
    }
    t[f] = l;
  }), Object.entries(t).forEach(([a, i]) => {
    n.append("cookie", `${a}=${i}`), o && (e.nativeEvent.node.req.headers.cookie += `${a}=${i};`);
  }), n;
}
async function L(e, n) {
  let t, s = new URL(e.request.headers.get("referer")).toString();
  n instanceof Response && (n.headers.has("X-Revalidate") && (t = n.headers.get("X-Revalidate").split(",")), n.headers.has("Location") && (s = new URL(n.headers.get("Location"), new URL(e.request.url).origin + "").toString()));
  const o = nt(e);
  return o.request = new Request(s, { headers: vt(e) }), await provideRequestEvent(o, async () => {
    await gt(o), $ || ($ = (await import('../build/app-B_kODm4M.mjs')).default), o.router.dataOnly = t || true, o.router.previousUrl = e.request.headers.get("referer");
    try {
      renderToString(() => {
        sharedConfig.context.event = o, $();
      });
    } catch (c) {
      console.log(c);
    }
    const a = o.router.data;
    if (!a) return n;
    let i = false;
    for (const c in a) a[c] === void 0 ? delete a[c] : i = true;
    return i && (n instanceof Response ? n.customBody && (a._$value = n.customBody()) : (a._$value = n, n = new Response(null, { status: 200 })), n.customBody = () => a, n.headers.set("X-Single-Flight", "true")), n;
  });
}
const Lt = eventHandler$1(bt);

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
  return useAssets(() => ssr(S$1(r))), { addTag(t) {
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
  return createComponent$1(y.Provider, { value: t, get children() {
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
function S$1(r) {
  return r.map((t) => {
    var _a, _b;
    const n = Object.keys(t.props).map((i) => i === "children" ? "" : ` ${i}="${escape(t.props[i], true)}"`).join("");
    let o = t.props.children;
    return Array.isArray(o) && (o = o.join("")), ((_a = t.setting) == null ? void 0 : _a.close) ? `<${t.tag} data-sm="${t.id}"${n}>${((_b = t.setting) == null ? void 0 : _b.escape) ? escape(o) : o || ""}</${t.tag}>` : `<${t.tag} data-sm="${t.id}"${n}/>`;
  }).join("");
}
const k = (r) => C("title", r, { escape: true, close: true }), H$1 = (r) => C("meta", r);

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, key + "" , value);
function Ht(e) {
  let t;
  const n = $e(e), s = { duplex: "half", method: e.method, headers: e.headers };
  return e.node.req.body instanceof ArrayBuffer ? new Request(n, { ...s, body: e.node.req.body }) : new Request(n, { ...s, get body() {
    return t || (t = Wt(e), t);
  } });
}
function qt(e) {
  var _a;
  return (_a = e.web) != null ? _a : e.web = { request: Ht(e), url: $e(e) }, e.web.request;
}
function kt() {
  return zt();
}
const Ae = /* @__PURE__ */ Symbol("$HTTPEvent");
function Ot(e) {
  return typeof e == "object" && (e instanceof H3Event || (e == null ? void 0 : e[Ae]) instanceof H3Event || (e == null ? void 0 : e.__is_event__) === true);
}
function S(e) {
  return function(...t) {
    var _a;
    let n = t[0];
    if (Ot(n)) t[0] = n instanceof H3Event || n.__is_event__ ? n : n[Ae];
    else {
      if (!((_a = globalThis.app.config.server.experimental) == null ? void 0 : _a.asyncContext)) throw new Error("AsyncLocalStorage was not enabled. Use the `server.experimental.asyncContext: true` option in your app configuration to enable it. Or, pass the instance of HTTPEvent that you have as the first argument to the function.");
      if (n = kt(), !n) throw new Error("No HTTPEvent found in AsyncLocalStorage. Make sure you are using the function within the server runtime.");
      t.unshift(n);
    }
    return e(...t);
  };
}
const $e = S(getRequestURL$1), Ft = S(getRequestIP), Q = S(setResponseStatus$1), ue = S(getResponseStatus), It = S(getResponseStatusText), G = S(getResponseHeaders), le = S(getResponseHeader$1), _t = S(setResponseHeader$1), Ut = S(appendResponseHeader$1), he = S(sendRedirect$1), Mt = S(getCookie), jt = S(setCookie), Nt = S(setHeader), Wt = S(getRequestWebStream), Bt = S(removeResponseHeader$1), Dt = S(qt);
function Kt() {
  var _a;
  return getContext("nitro-app", { asyncContext: !!((_a = globalThis.app.config.server.experimental) == null ? void 0 : _a.asyncContext), AsyncLocalStorage: AsyncLocalStorage });
}
function zt() {
  return Kt().use().event;
}
const Pe = [{ page: true, $component: { src: "src/routes/index.tsx?pick=default&pick=$css", build: () => import('../build/index2.mjs'), import: () => import('../build/index2.mjs') }, path: "/", filePath: "/website/src/routes/index.tsx" }], Gt = Jt(Pe.filter((e) => e.page));
function Jt(e) {
  function t(n, s, r, o) {
    const a = Object.values(n).find((i) => r.startsWith(i.id + "/"));
    return a ? (t(a.children || (a.children = []), s, r.slice(a.id.length)), n) : (n.push({ ...s, id: r, path: r.replace(/\([^)/]+\)/g, "").replace(/\/+/g, "/") }), n);
  }
  return e.sort((n, s) => n.path.length - s.path.length).reduce((n, s) => t(n, s, s.path, s.path), []);
}
function Vt(e, t) {
  const n = Yt.lookup(e);
  if (n && n.route) {
    const s = n.route, r = t === "HEAD" ? s.$HEAD || s.$GET : s[`$${t}`];
    if (r === void 0) return;
    const o = s.page === true && s.$component !== void 0;
    return { handler: r, params: n.params, isPage: o };
  }
}
function Xt(e) {
  return e.$HEAD || e.$GET || e.$POST || e.$PUT || e.$PATCH || e.$DELETE;
}
const Yt = createRouter({ routes: Pe.reduce((e, t) => {
  if (!Xt(t)) return e;
  let n = t.path.replace(/\([^)/]+\)/g, "").replace(/\/+/g, "/").replace(/\*([^/]*)/g, (s, r) => `**:${r}`).split("/").map((s) => s.startsWith(":") || s.startsWith("*") ? s : encodeURIComponent(s)).join("/");
  if (/:[^/]*\?/g.test(n)) throw new Error(`Optional parameters are not supported in API routes: ${n}`);
  if (e[n]) throw new Error(`Duplicate API routes for "${n}" found at "${e[n].route.path}" and "${t.path}"`);
  return e[n] = { route: t }, e;
}, {}) }), V = "solidFetchEvent";
function Qt(e) {
  return { request: Dt(e), response: tn(e), clientAddress: Ft(e), locals: {}, nativeEvent: e };
}
function Zt(e) {
  if (!e.context[V]) {
    const t = Qt(e);
    e.context[V] = t;
  }
  return e.context[V];
}
class en {
  constructor(t) {
    __publicField(this, "event");
    this.event = t;
  }
  get(t) {
    const n = le(this.event, t);
    return Array.isArray(n) ? n.join(", ") : n || null;
  }
  has(t) {
    return this.get(t) !== null;
  }
  set(t, n) {
    return _t(this.event, t, n);
  }
  delete(t) {
    return Bt(this.event, t);
  }
  append(t, n) {
    Ut(this.event, t, n);
  }
  getSetCookie() {
    const t = le(this.event, "Set-Cookie");
    return Array.isArray(t) ? t : [t];
  }
  forEach(t) {
    return Object.entries(G(this.event)).forEach(([n, s]) => t(Array.isArray(s) ? s.join(", ") : s, n, this));
  }
  entries() {
    return Object.entries(G(this.event)).map(([t, n]) => [t, Array.isArray(n) ? n.join(", ") : n])[Symbol.iterator]();
  }
  keys() {
    return Object.keys(G(this.event))[Symbol.iterator]();
  }
  values() {
    return Object.values(G(this.event)).map((t) => Array.isArray(t) ? t.join(", ") : t)[Symbol.iterator]();
  }
  [Symbol.iterator]() {
    return this.entries()[Symbol.iterator]();
  }
}
function tn(e) {
  return { get status() {
    return ue(e);
  }, set status(t) {
    Q(e, t);
  }, get statusText() {
    return It(e);
  }, set statusText(t) {
    Q(e, ue(e), t);
  }, headers: new en(e) };
}
var rn = " ";
const sn = { style: (e) => ssrElement("style", e.attrs, () => e.children, true), link: (e) => ssrElement("link", e.attrs, void 0, true), script: (e) => e.attrs.src ? ssrElement("script", mergeProps(() => e.attrs, { get id() {
  return e.key;
} }), () => ssr(rn), true) : null, noscript: (e) => ssrElement("noscript", e.attrs, () => escape(e.children), true) };
function Z(e, t) {
  let { tag: n, attrs: { key: s, ...r } = { key: void 0 }, children: o } = e;
  return sn[n]({ attrs: { ...r, nonce: t }, key: s, children: o });
}
function on(e, t, n, s = "default") {
  return lazy(async () => {
    var _a;
    {
      const o = (await e.import())[s], i = (await ((_a = t.inputs) == null ? void 0 : _a[e.src].assets())).filter((u) => u.tag === "style" || u.attrs.rel === "stylesheet");
      return { default: (u) => [...i.map((h) => Z(h)), createComponent(o, u)] };
    }
  });
}
function Te() {
  function e(n) {
    return { ...n, ...n.$$route ? n.$$route.require().route : void 0, info: { ...n.$$route ? n.$$route.require().route.info : {}, filesystem: true }, component: n.$component && on(n.$component, globalThis.MANIFEST.client, globalThis.MANIFEST.ssr), children: n.children ? n.children.map(e) : void 0 };
  }
  return Gt.map(e);
}
let de;
const an = isServer ? () => getRequestEvent().routes : () => de || (de = Te());
function cn(e) {
  const t = Mt(e.nativeEvent, "flash");
  if (t) try {
    let n = JSON.parse(t);
    if (!n || !n.result) return;
    const s = [...n.input.slice(0, -1), new Map(n.input[n.input.length - 1])], r = n.error ? new Error(n.result) : n.result;
    return { input: s, url: n.url, pending: false, result: n.thrown ? void 0 : r, error: n.thrown ? r : void 0 };
  } catch (n) {
    console.error(n);
  } finally {
    jt(e.nativeEvent, "flash", "", { maxAge: 0 });
  }
}
async function un(e) {
  const t = globalThis.MANIFEST.client;
  return globalThis.MANIFEST.ssr, e.response.headers.set("Content-Type", "text/html"), Object.assign(e, { manifest: await t.json(), assets: [...await t.inputs[t.handler].assets()], router: { submission: cn(e) }, routes: Te(), complete: false, $islands: /* @__PURE__ */ new Set() });
}
const ln = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
function ee(e) {
  return e.status && ln.has(e.status) ? e.status : 302;
}
function hn(e, t, n = {}, s) {
  return eventHandler$1({ handler: (r) => {
    const o = Zt(r);
    return provideRequestEvent(o, async () => {
      const a = Vt(new URL(o.request.url).pathname, o.request.method);
      if (a) {
        const d = await a.handler.import(), g = o.request.method === "HEAD" ? d.HEAD || d.GET : d[o.request.method];
        o.params = a.params || {}, sharedConfig.context = { event: o };
        const l = await g(o);
        if (l !== void 0) return l;
        if (o.request.method !== "GET") throw new Error(`API handler for ${o.request.method} "${o.request.url}" did not return a response.`);
        if (!a.isPage) return;
      }
      const i = await t(o), c = typeof n == "function" ? await n(i) : { ...n }, u = c.mode || "stream";
      if (c.nonce && (i.nonce = c.nonce), u === "sync") {
        const d = renderToString(() => (sharedConfig.context.event = i, e(i)), c);
        if (i.complete = true, i.response && i.response.headers.get("Location")) {
          const g = ee(i.response);
          return he(r, i.response.headers.get("Location"), g);
        }
        return d;
      }
      if (c.onCompleteAll) {
        const d = c.onCompleteAll;
        c.onCompleteAll = (g) => {
          pe(i)(g), d(g);
        };
      } else c.onCompleteAll = pe(i);
      if (c.onCompleteShell) {
        const d = c.onCompleteShell;
        c.onCompleteShell = (g) => {
          fe(i, r)(), d(g);
        };
      } else c.onCompleteShell = fe(i, r);
      const h = renderToStream(() => (sharedConfig.context.event = i, e(i)), c);
      if (i.response && i.response.headers.get("Location")) {
        const d = ee(i.response);
        return he(r, i.response.headers.get("Location"), d);
      }
      if (u === "async") return h;
      const { writable: v, readable: m } = new TransformStream();
      return h.pipeTo(v), m;
    });
  } });
}
function fe(e, t) {
  return () => {
    if (e.response && e.response.headers.get("Location")) {
      const n = ee(e.response);
      Q(t, n), Nt(t, "Location", e.response.headers.get("Location"));
    }
  };
}
function pe(e) {
  return ({ write: t }) => {
    e.complete = true;
    const n = e.response && e.response.headers.get("Location");
    n && t(`<script>window.location="${n}"<\/script>`);
  };
}
function dn(e, t, n) {
  return hn(e, un, t);
}
function Ce() {
  let e = /* @__PURE__ */ new Set();
  function t(r) {
    return e.add(r), () => e.delete(r);
  }
  let n = false;
  function s(r, o) {
    if (n) return !(n = false);
    const a = { to: r, options: o, defaultPrevented: false, preventDefault: () => a.defaultPrevented = true };
    for (const i of e) i.listener({ ...a, from: i.location, retry: (c) => {
      c && (n = true), i.navigate(r, { ...o, resolve: false });
    } });
    return !a.defaultPrevented;
  }
  return { subscribe: t, confirm: s };
}
let te;
function se() {
  (!window.history.state || window.history.state._depth == null) && window.history.replaceState({ ...window.history.state, _depth: window.history.length - 1 }, ""), te = window.history.state._depth;
}
isServer || se();
function fn(e) {
  return { ...e, _depth: window.history.state && window.history.state._depth };
}
function pn(e, t) {
  let n = false;
  return () => {
    const s = te;
    se();
    const r = s == null ? null : te - s;
    if (n) {
      n = false;
      return;
    }
    r && t(r) ? (n = true, window.history.go(-r)) : e();
  };
}
const mn = /^(?:[a-z0-9]+:)?\/\//i, gn = /^\/+|(\/)\/+$/g, xe = "http://sr";
function N(e, t = false) {
  const n = e.replace(gn, "$1");
  return n ? t || /^[?#]/.test(n) ? n : "/" + n : "";
}
function J(e, t, n) {
  if (mn.test(t)) return;
  const s = N(e), r = n && N(n);
  let o = "";
  return !r || t.startsWith("/") ? o = s : r.toLowerCase().indexOf(s.toLowerCase()) !== 0 ? o = s + r : o = r, (o || "/") + N(t, !o);
}
function yn(e, t) {
  return N(e).replace(/\/*(\*.*)?$/g, "") + N(t);
}
function Le(e) {
  const t = {};
  return e.searchParams.forEach((n, s) => {
    s in t ? Array.isArray(t[s]) ? t[s].push(n) : t[s] = [t[s], n] : t[s] = n;
  }), t;
}
function wn(e, t, n) {
  const [s, r] = e.split("/*", 2), o = s.split("/").filter(Boolean), a = o.length;
  return (i) => {
    const c = i.split("/").filter(Boolean), u = c.length - a;
    if (u < 0 || u > 0 && r === void 0 && !t) return null;
    const h = { path: a ? "" : "/", params: {} }, v = (m) => n === void 0 ? void 0 : n[m];
    for (let m = 0; m < a; m++) {
      const d = o[m], g = d[0] === ":", l = g ? c[m] : c[m].toLowerCase(), f = g ? d.slice(1) : d.toLowerCase();
      if (g && X(l, v(f))) h.params[f] = l;
      else if (g || !X(l, f)) return null;
      h.path += `/${l}`;
    }
    if (r) {
      const m = u ? c.slice(-u).join("/") : "";
      if (X(m, v(r))) h.params[r] = m;
      else return null;
    }
    return h;
  };
}
function X(e, t) {
  const n = (s) => s === e;
  return t === void 0 ? true : typeof t == "string" ? n(t) : typeof t == "function" ? t(e) : Array.isArray(t) ? t.some(n) : t instanceof RegExp ? t.test(e) : false;
}
function vn(e) {
  const [t, n] = e.pattern.split("/*", 2), s = t.split("/").filter(Boolean);
  return s.reduce((r, o) => r + (o.startsWith(":") ? 2 : 3), s.length - (n === void 0 ? 0 : 1));
}
function He(e) {
  const t = /* @__PURE__ */ new Map(), n = getOwner();
  return new Proxy({}, { get(s, r) {
    return t.has(r) || runWithOwner(n, () => t.set(r, createMemo(() => e()[r]))), t.get(r)();
  }, getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  }, ownKeys() {
    return Reflect.ownKeys(e());
  }, has(s, r) {
    return r in e();
  } });
}
function qe(e) {
  let t = /(\/?\:[^\/]+)\?/.exec(e);
  if (!t) return [e];
  let n = e.slice(0, t.index), s = e.slice(t.index + t[0].length);
  const r = [n, n += t[1]];
  for (; t = /^(\/\:[^\/]+)\?/.exec(s); ) r.push(n += t[1]), s = s.slice(t[0].length);
  return qe(s).reduce((o, a) => [...o, ...r.map((i) => i + a)], []);
}
const Rn = 100, bn = createContext(), ke = createContext();
function Sn(e, t = "") {
  const { component: n, preload: s, load: r, children: o, info: a } = e, i = !o || Array.isArray(o) && !o.length, c = { key: e, component: n, preload: s || r, info: a };
  return Oe(e.path).reduce((u, h) => {
    for (const v of qe(h)) {
      const m = yn(t, v);
      let d = i ? m : m.split("/*", 1)[0];
      d = d.split("/").map((g) => g.startsWith(":") || g.startsWith("*") ? g : encodeURIComponent(g)).join("/"), u.push({ ...c, originalPath: h, pattern: d, matcher: wn(d, !i, e.matchFilters) });
    }
    return u;
  }, []);
}
function En(e, t = 0) {
  return { routes: e, score: vn(e[e.length - 1]) * 1e4 - t, matcher(n) {
    const s = [];
    for (let r = e.length - 1; r >= 0; r--) {
      const o = e[r], a = o.matcher(n);
      if (!a) return null;
      s.unshift({ ...a, route: o });
    }
    return s;
  } };
}
function Oe(e) {
  return Array.isArray(e) ? e : [e];
}
function Fe(e, t = "", n = [], s = []) {
  const r = Oe(e);
  for (let o = 0, a = r.length; o < a; o++) {
    const i = r[o];
    if (i && typeof i == "object") {
      i.hasOwnProperty("path") || (i.path = "");
      const c = Sn(i, t);
      for (const u of c) {
        n.push(u);
        const h = Array.isArray(i.children) && i.children.length === 0;
        if (i.children && !h) Fe(i.children, u.pattern, n, s);
        else {
          const v = En([...n], s.length);
          s.push(v);
        }
        n.pop();
      }
    }
  }
  return n.length ? s : s.sort((o, a) => a.score - o.score);
}
function W(e, t) {
  for (let n = 0, s = e.length; n < s; n++) {
    const r = e[n].matcher(t);
    if (r) return r;
  }
  return [];
}
function An(e, t, n) {
  const s = new URL(xe), r = createMemo((h) => {
    const v = e();
    try {
      return new URL(v, s);
    } catch {
      return console.error(`Invalid path ${v}`), h;
    }
  }, s, { equals: (h, v) => h.href === v.href }), o = createMemo(() => r().pathname), a = createMemo(() => r().search, true), i = createMemo(() => r().hash), c = () => "", u = on$1(a, () => Le(r()));
  return { get pathname() {
    return o();
  }, get search() {
    return a();
  }, get hash() {
    return i();
  }, get state() {
    return t();
  }, get key() {
    return c();
  }, query: n ? n(u) : He(u) };
}
let H;
function $n() {
  return H;
}
function Pn(e, t, n, s = {}) {
  const { signal: [r, o], utils: a = {} } = e, i = a.parsePath || ((p) => p), c = a.renderPath || ((p) => p), u = a.beforeLeave || Ce(), h = J("", s.base || "");
  if (h === void 0) throw new Error(`${h} is not a valid base path`);
  h && !r().value && o({ value: h, replace: true, scroll: false });
  const [v, m] = createSignal(false);
  let d;
  const g = (p, y) => {
    y.value === l() && y.state === b() || (d === void 0 && m(true), H = p, d = y, startTransition(() => {
      d === y && (f(d.value), R(d.state), resetErrorBoundaries(), isServer || L[1]((E) => E.filter((O) => O.pending)));
    }).finally(() => {
      d === y && batch(() => {
        H = void 0, p === "navigate" && We(d), m(false), d = void 0;
      });
    }));
  }, [l, f] = createSignal(r().value), [b, R] = createSignal(r().state), x = An(l, b, a.queryWrapper), A = [], L = createSignal(isServer ? De() : []), M = createMemo(() => typeof s.transformUrl == "function" ? W(t(), s.transformUrl(x.pathname)) : W(t(), x.pathname)), oe = () => {
    const p = M(), y = {};
    for (let E = 0; E < p.length; E++) Object.assign(y, p[E].params);
    return y;
  }, Me = a.paramsWrapper ? a.paramsWrapper(oe, t) : He(oe), ae = { pattern: h, path: () => h, outlet: () => null, resolvePath(p) {
    return J(h, p);
  } };
  return createRenderEffect(on$1(r, (p) => g("native", p), { defer: true })), { base: ae, location: x, params: Me, isRouting: v, renderPath: c, parsePath: i, navigatorFactory: Ne, matches: M, beforeLeave: u, preloadRoute: Be, singleFlight: s.singleFlight === void 0 ? true : s.singleFlight, submissions: L };
  function je(p, y, E) {
    untrack(() => {
      if (typeof y == "number") {
        y && (a.go ? a.go(y) : console.warn("Router integration does not support relative routing"));
        return;
      }
      const O = !y || y[0] === "?", { replace: B, resolve: F, scroll: D, state: I } = { replace: false, resolve: !O, scroll: true, ...E }, _ = F ? p.resolvePath(y) : J(O && x.pathname || "", y);
      if (_ === void 0) throw new Error(`Path '${y}' is not a routable path`);
      if (A.length >= Rn) throw new Error("Too many redirects");
      const ie = l();
      if (_ !== ie || I !== b()) if (isServer) {
        const ce = getRequestEvent();
        ce && (ce.response = { status: 302, headers: new Headers({ Location: _ }) }), o({ value: _, replace: B, scroll: D, state: I });
      } else u.confirm(_, E) && (A.push({ value: ie, replace: B, scroll: D, state: b() }), g("navigate", { value: _, state: I }));
    });
  }
  function Ne(p) {
    return p = p || useContext(ke) || ae, (y, E) => je(p, y, E);
  }
  function We(p) {
    const y = A[0];
    y && (o({ ...p, replace: y.replace, scroll: y.scroll }), A.length = 0);
  }
  function Be(p, y) {
    const E = W(t(), p.pathname), O = H;
    H = "preload";
    for (let B in E) {
      const { route: F, params: D } = E[B];
      F.component && F.component.preload && F.component.preload();
      const { preload: I } = F;
      y && I && runWithOwner(n(), () => I({ params: D, location: { pathname: p.pathname, search: p.search, hash: p.hash, query: Le(p), state: null, key: "" }, intent: "preload" }));
    }
    H = O;
  }
  function De() {
    const p = getRequestEvent();
    return p && p.router && p.router.submission ? [p.router.submission] : [];
  }
}
function Tn(e, t, n, s) {
  const { base: r, location: o, params: a } = e, { pattern: i, component: c, preload: u } = s().route, h = createMemo(() => s().path);
  c && c.preload && c.preload();
  const v = u ? u({ params: a, location: o, intent: H || "initial" }) : void 0;
  return { parent: t, pattern: i, path: h, outlet: () => c ? createComponent(c, { params: a, location: o, data: v, get children() {
    return n();
  } }) : n(), resolvePath(d) {
    return J(r.path(), d, h());
  } };
}
const Ie = (e) => (t) => {
  const { base: n } = t, s = children(() => t.children), r = createMemo(() => Fe(s(), t.base || ""));
  let o;
  const a = Pn(e, r, () => o, { base: n, singleFlight: t.singleFlight, transformUrl: t.transformUrl });
  return e.create && e.create(a), createComponent$1(bn.Provider, { value: a, get children() {
    return createComponent$1(Cn, { routerState: a, get root() {
      return t.root;
    }, get preload() {
      return t.rootPreload || t.rootLoad;
    }, get children() {
      return [(o = getOwner()) && null, createComponent$1(xn, { routerState: a, get branches() {
        return r();
      } })];
    } });
  } });
};
function Cn(e) {
  const t = e.routerState.location, n = e.routerState.params, s = createMemo(() => e.preload && untrack(() => {
    e.preload({ params: n, location: t, intent: $n() || "initial" });
  }));
  return createComponent$1(Show, { get when() {
    return e.root;
  }, keyed: true, get fallback() {
    return e.children;
  }, children: (r) => createComponent$1(r, { params: n, location: t, get data() {
    return s();
  }, get children() {
    return e.children;
  } }) });
}
function xn(e) {
  if (isServer) {
    const r = getRequestEvent();
    if (r && r.router && r.router.dataOnly) {
      Ln(r, e.routerState, e.branches);
      return;
    }
    r && ((r.router || (r.router = {})).matches || (r.router.matches = e.routerState.matches().map(({ route: o, path: a, params: i }) => ({ path: o.originalPath, pattern: o.pattern, match: a, params: i, info: o.info }))));
  }
  const t = [];
  let n;
  const s = createMemo(on$1(e.routerState.matches, (r, o, a) => {
    let i = o && r.length === o.length;
    const c = [];
    for (let u = 0, h = r.length; u < h; u++) {
      const v = o && o[u], m = r[u];
      a && v && m.route.key === v.route.key ? c[u] = a[u] : (i = false, t[u] && t[u](), createRoot((d) => {
        t[u] = d, c[u] = Tn(e.routerState, c[u - 1] || e.routerState.base, me(() => s()[u + 1]), () => {
          var _a;
          const g = e.routerState.matches();
          return (_a = g[u]) != null ? _a : g[0];
        });
      }));
    }
    return t.splice(r.length).forEach((u) => u()), a && i ? a : (n = c[0], c);
  }));
  return me(() => s() && n)();
}
const me = (e) => () => createComponent$1(Show, { get when() {
  return e();
}, keyed: true, children: (t) => createComponent$1(ke.Provider, { value: t, get children() {
  return t.outlet();
} }) });
function Ln(e, t, n) {
  const s = new URL(e.request.url), r = W(n, new URL(e.router.previousUrl || e.request.url).pathname), o = W(n, s.pathname);
  for (let a = 0; a < o.length; a++) {
    (!r[a] || o[a].route !== r[a].route) && (e.router.dataOnly = true);
    const { route: i, params: c } = o[a];
    i.preload && i.preload({ params: c, location: t.location, intent: "preload" });
  }
}
function Hn([e, t], n, s) {
  return [e, s ? (r) => t(s(r)) : t];
}
function qn(e) {
  let t = false;
  const n = (r) => typeof r == "string" ? { value: r } : r, s = Hn(createSignal(n(e.get()), { equals: (r, o) => r.value === o.value && r.state === o.state }), void 0, (r) => (!t && e.set(r), sharedConfig.registry && !sharedConfig.done && (sharedConfig.done = true), r));
  return e.init && onCleanup(e.init((r = e.get()) => {
    t = true, s[1](n(r)), t = false;
  })), Ie({ signal: s, create: e.create, utils: e.utils });
}
function kn(e, t, n) {
  return e.addEventListener(t, n), () => e.removeEventListener(t, n);
}
function On(e, t) {
  const n = e && document.getElementById(e);
  n ? n.scrollIntoView() : t && window.scrollTo(0, 0);
}
function Fn(e) {
  const t = new URL(e);
  return t.pathname + t.search;
}
function In(e) {
  let t;
  const n = { value: e.url || (t = getRequestEvent()) && Fn(t.request.url) || "" };
  return Ie({ signal: [() => n, (s) => Object.assign(n, s)] })(e);
}
const _n = /* @__PURE__ */ new Map();
function Un(e = true, t = false, n = "/_server", s) {
  return (r) => {
    const o = r.base.path(), a = r.navigatorFactory(r.base);
    let i, c;
    function u(l) {
      return l.namespaceURI === "http://www.w3.org/2000/svg";
    }
    function h(l) {
      if (l.defaultPrevented || l.button !== 0 || l.metaKey || l.altKey || l.ctrlKey || l.shiftKey) return;
      const f = l.composedPath().find((M) => M instanceof Node && M.nodeName.toUpperCase() === "A");
      if (!f || t && !f.hasAttribute("link")) return;
      const b = u(f), R = b ? f.href.baseVal : f.href;
      if ((b ? f.target.baseVal : f.target) || !R && !f.hasAttribute("state")) return;
      const A = (f.getAttribute("rel") || "").split(/\s+/);
      if (f.hasAttribute("download") || A && A.includes("external")) return;
      const L = b ? new URL(R, document.baseURI) : new URL(R);
      if (!(L.origin !== window.location.origin || o && L.pathname && !L.pathname.toLowerCase().startsWith(o.toLowerCase()))) return [f, L];
    }
    function v(l) {
      const f = h(l);
      if (!f) return;
      const [b, R] = f, x = r.parsePath(R.pathname + R.search + R.hash), A = b.getAttribute("state");
      l.preventDefault(), a(x, { resolve: false, replace: b.hasAttribute("replace"), scroll: !b.hasAttribute("noscroll"), state: A ? JSON.parse(A) : void 0 });
    }
    function m(l) {
      const f = h(l);
      if (!f) return;
      const [b, R] = f;
      s && (R.pathname = s(R.pathname)), r.preloadRoute(R, b.getAttribute("preload") !== "false");
    }
    function d(l) {
      clearTimeout(i);
      const f = h(l);
      if (!f) return c = null;
      const [b, R] = f;
      c !== b && (s && (R.pathname = s(R.pathname)), i = setTimeout(() => {
        r.preloadRoute(R, b.getAttribute("preload") !== "false"), c = b;
      }, 20));
    }
    function g(l) {
      if (l.defaultPrevented) return;
      let f = l.submitter && l.submitter.hasAttribute("formaction") ? l.submitter.getAttribute("formaction") : l.target.getAttribute("action");
      if (!f) return;
      if (!f.startsWith("https://action/")) {
        const R = new URL(f, xe);
        if (f = r.parsePath(R.pathname + R.search), !f.startsWith(n)) return;
      }
      if (l.target.method.toUpperCase() !== "POST") throw new Error("Only POST forms are supported for Actions");
      const b = _n.get(f);
      if (b) {
        l.preventDefault();
        const R = new FormData(l.target, l.submitter);
        b.call({ r, f: l.target }, l.target.enctype === "multipart/form-data" ? R : new URLSearchParams(R));
      }
    }
    delegateEvents(["click", "submit"]), document.addEventListener("click", v), e && (document.addEventListener("mousemove", d, { passive: true }), document.addEventListener("focusin", m, { passive: true }), document.addEventListener("touchstart", m, { passive: true })), document.addEventListener("submit", g), onCleanup(() => {
      document.removeEventListener("click", v), e && (document.removeEventListener("mousemove", d), document.removeEventListener("focusin", m), document.removeEventListener("touchstart", m)), document.removeEventListener("submit", g);
    });
  };
}
function Mn(e) {
  if (isServer) return In(e);
  const t = () => {
    const s = window.location.pathname.replace(/^\/+/, "/") + window.location.search, r = window.history.state && window.history.state._depth && Object.keys(window.history.state).length === 1 ? void 0 : window.history.state;
    return { value: s + window.location.hash, state: r };
  }, n = Ce();
  return qn({ get: t, set({ value: s, replace: r, scroll: o, state: a }) {
    r ? window.history.replaceState(fn(a), "", s) : window.history.pushState(a, "", s), On(decodeURIComponent(window.location.hash.slice(1)), o), se();
  }, init: (s) => kn(window, "popstate", pn(s, (r) => {
    if (r) return !n.confirm(r);
    {
      const o = t();
      return !n.confirm(o.value, { state: o.state });
    }
  })), create: Un(e.preload, e.explicitLinks, e.actionBase, e.transformUrl), utils: { go: (s) => window.history.go(s), beforeLeave: n } })(e);
}
function jn() {
  return createComponent$1(Mn, { root: (e) => createComponent$1(I, { get children() {
    return [createComponent$1(k, { children: "Takos \u2014 AI-first chat & agent, your own server." }), createComponent$1(Suspense, { get children() {
      return e.children;
    } })];
  } }), get children() {
    return createComponent$1(an, {});
  } });
}
const _e = isServer ? (e) => {
  const t = getRequestEvent();
  return t.response.status = e.code, t.response.statusText = e.text, onCleanup(() => !t.nativeEvent.handled && !t.complete && (t.response.status = 200)), null;
} : (e) => null;
var Nn = ["<span", ' style="font-size:1.5em;text-align:center;position:fixed;left:0px;bottom:55%;width:100%;">', "</span>"], Wn = ["<span", ' style="font-size:1.5em;text-align:center;position:fixed;left:0px;bottom:55%;width:100%;">500 | Internal Server Error</span>'];
const Bn = (e) => {
  const t = isServer ? "500 | Internal Server Error" : "Error | Uncaught Client Exception";
  return createComponent$1(ErrorBoundary, { fallback: (n) => (console.error(n), [ssr(Nn, ssrHydrationKey(), escape(t)), createComponent$1(_e, { code: 500 })]), get children() {
    return e.children;
  } });
}, Dn = (e) => {
  let t = false;
  const n = catchError(() => e.children, (s) => {
    console.error(s), t = !!s;
  });
  return t ? [ssr(Wn, ssrHydrationKey()), createComponent$1(_e, { code: 500 })] : n;
};
var ge = ["<script", ">", "<\/script>"], Kn = ["<script", ' type="module"', " async", "><\/script>"], zn = ["<script", ' type="module" async', "><\/script>"];
const Gn = ssr("<!DOCTYPE html>");
function Ue(e, t, n = []) {
  for (let s = 0; s < t.length; s++) {
    const r = t[s];
    if (r.path !== e[0].path) continue;
    let o = [...n, r];
    if (r.children) {
      const a = e.slice(1);
      if (a.length === 0 || (o = Ue(a, r.children, o), !o)) continue;
    }
    return o;
  }
}
function Jn(e) {
  const t = getRequestEvent(), n = t.nonce;
  let s = [];
  return Promise.resolve().then(async () => {
    let r = [];
    if (t.router && t.router.matches) {
      const o = [...t.router.matches];
      for (; o.length && (!o[0].info || !o[0].info.filesystem); ) o.shift();
      const a = o.length && Ue(o, t.routes);
      if (a) {
        const i = globalThis.MANIFEST.client.inputs;
        for (let c = 0; c < a.length; c++) {
          const u = a[c], h = i[u.$component.src];
          r.push(h.assets());
        }
      }
    }
    s = await Promise.all(r).then((o) => [...new Map(o.flat().map((a) => [a.attrs.key, a])).values()].filter((a) => a.attrs.rel === "modulepreload" && !t.assets.find((i) => i.attrs.key === a.attrs.key)));
  }), useAssets(() => s.length ? s.map((r) => Z(r)) : void 0), createComponent$1(NoHydration, { get children() {
    return [Gn, createComponent$1(Dn, { get children() {
      return createComponent$1(e.document, { get assets() {
        return [createComponent$1(HydrationScript, {}), t.assets.map((r) => Z(r, n))];
      }, get scripts() {
        return n ? [ssr(ge, ssrHydrationKey() + ssrAttribute("nonce", escape(n, true), false), `window.manifest = ${JSON.stringify(t.manifest)}`), ssr(Kn, ssrHydrationKey(), ssrAttribute("nonce", escape(n, true), false), ssrAttribute("src", escape(globalThis.MANIFEST.client.inputs[globalThis.MANIFEST.client.handler].output.path, true), false))] : [ssr(ge, ssrHydrationKey(), `window.manifest = ${JSON.stringify(t.manifest)}`), ssr(zn, ssrHydrationKey(), ssrAttribute("src", escape(globalThis.MANIFEST.client.inputs[globalThis.MANIFEST.client.handler].output.path, true), false))];
      }, get children() {
        return createComponent$1(Hydration, { get children() {
          return createComponent$1(Bn, { get children() {
            return createComponent$1(jn, {});
          } });
        } });
      } });
    } })];
  } });
}
var Vn = ['<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/brand/favicon.svg">', "</head>"], Xn = ["<html", ' lang="ja">', '<body><div id="app">', "</div><!--$-->", "<!--/--></body></html>"];
const or = dn(() => createComponent$1(Jn, { document: ({ assets: e, children: t, scripts: n }) => ssr(Xn, ssrHydrationKey(), createComponent$1(NoHydration, { get children() {
  return ssr(Vn, escape(e));
} }), escape(t), escape(n)) }));

const handlers = [
  { route: '', handler: _PS91mO, lazy: false, middleware: true, method: undefined },
  { route: '/_server', handler: Lt, lazy: false, middleware: true, method: undefined },
  { route: '/', handler: or, lazy: false, middleware: true, method: undefined }
];

function createNitroApp() {
  const config = useRuntimeConfig();
  const hooks = createHooks();
  const captureError = (error, context = {}) => {
    const promise = hooks.callHookParallel("error", error, context).catch((error_) => {
      console.error("Error while capturing another error", error_);
    });
    if (context.event && isEvent(context.event)) {
      const errors = context.event.context.nitro?.errors;
      if (errors) {
        errors.push({ error, context });
      }
      if (context.event.waitUntil) {
        context.event.waitUntil(promise);
      }
    }
  };
  const h3App = createApp({
    debug: destr(false),
    onError: (error, event) => {
      captureError(error, { event, tags: ["request"] });
      return errorHandler(error, event);
    },
    onRequest: async (event) => {
      event.context.nitro = event.context.nitro || { errors: [] };
      const fetchContext = event.node.req?.__unenv__;
      if (fetchContext?._platform) {
        event.context = {
          _platform: fetchContext?._platform,
          // #3335
          ...fetchContext._platform,
          ...event.context
        };
      }
      if (!event.context.waitUntil && fetchContext?.waitUntil) {
        event.context.waitUntil = fetchContext.waitUntil;
      }
      event.fetch = (req, init) => fetchWithEvent(event, req, init, { fetch: localFetch });
      event.$fetch = (req, init) => fetchWithEvent(event, req, init, {
        fetch: $fetch
      });
      event.waitUntil = (promise) => {
        if (!event.context.nitro._waitUntilPromises) {
          event.context.nitro._waitUntilPromises = [];
        }
        event.context.nitro._waitUntilPromises.push(promise);
        if (event.context.waitUntil) {
          event.context.waitUntil(promise);
        }
      };
      event.captureError = (error, context) => {
        captureError(error, { event, ...context });
      };
      await nitroApp$1.hooks.callHook("request", event).catch((error) => {
        captureError(error, { event, tags: ["request"] });
      });
    },
    onBeforeResponse: async (event, response) => {
      await nitroApp$1.hooks.callHook("beforeResponse", event, response).catch((error) => {
        captureError(error, { event, tags: ["request", "response"] });
      });
    },
    onAfterResponse: async (event, response) => {
      await nitroApp$1.hooks.callHook("afterResponse", event, response).catch((error) => {
        captureError(error, { event, tags: ["request", "response"] });
      });
    }
  });
  const router = createRouter$1({
    preemptive: true
  });
  const nodeHandler = toNodeListener(h3App);
  const localCall = (aRequest) => callNodeRequestHandler(
    nodeHandler,
    aRequest
  );
  const localFetch = (input, init) => {
    if (!input.toString().startsWith("/")) {
      return globalThis.fetch(input, init);
    }
    return fetchNodeRequestHandler(
      nodeHandler,
      input,
      init
    ).then((response) => normalizeFetchResponse(response));
  };
  const $fetch = createFetch({
    fetch: localFetch,
    Headers: Headers$1,
    defaults: { baseURL: config.app.baseURL }
  });
  globalThis.$fetch = $fetch;
  h3App.use(createRouteRulesHandler({ localFetch }));
  for (const h of handlers) {
    let handler = h.lazy ? lazyEventHandler(h.handler) : h.handler;
    if (h.middleware || !h.route) {
      const middlewareBase = (config.app.baseURL + (h.route || "/")).replace(
        /\/+/g,
        "/"
      );
      h3App.use(middlewareBase, handler);
    } else {
      const routeRules = getRouteRulesForPath(
        h.route.replace(/:\w+|\*\*/g, "_")
      );
      if (routeRules.cache) {
        handler = cachedEventHandler(handler, {
          group: "nitro/routes",
          ...routeRules.cache
        });
      }
      router.use(h.route, handler, h.method);
    }
  }
  h3App.use(config.app.baseURL, router.handler);
  {
    const _handler = h3App.handler;
    h3App.handler = (event) => {
      const ctx = { event };
      return nitroAsyncContext.callAsync(ctx, () => _handler(event));
    };
  }
  const app = {
    hooks,
    h3App,
    router,
    localCall,
    localFetch,
    captureError
  };
  return app;
}
function runNitroPlugins(nitroApp2) {
  for (const plugin of plugins) {
    try {
      plugin(nitroApp2);
    } catch (error) {
      nitroApp2.captureError(error, { tags: ["plugin"] });
      throw error;
    }
  }
}
const nitroApp$1 = createNitroApp();
function useNitroApp() {
  return nitroApp$1;
}
runNitroPlugins(nitroApp$1);

const nitroApp = useNitroApp();
const localFetch = nitroApp.localFetch;
const closePrerenderer = () => nitroApp.hooks.callHook("close");
trapUnhandledNodeErrors();

export { Ft$1 as F, H$1 as H, closePrerenderer as c, k, localFetch as l };
//# sourceMappingURL=nitro.mjs.map
