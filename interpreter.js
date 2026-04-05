// Page Redirector - Stack Language Interpreter
// Implements the CPS-trampolined VM specified in vm-spec.md
export class Interpreter {
  constructor(options = {}) {
    this.maxOps = options.maxOps || 1024;
    this.maxStack = 64;
    this.maxCallStack = options.maxCallStack || 16;
    this.maxStringLen = 4096;
    this.maxArrayLen = 256;
    this.dictionary = { ...this.buildIns() };
  }
  static getDocs() {
    return {
      "dup": "( x -- x x )",
      "drop": "( x -- )",
      "swap": "( x y -- y x )",
      "over": "( x y -- x y x )",
      "rot": "( x y z -- y z x )",
      "$t": "( x -- x x )",
      "host": "( url -- host )",
      "path": "( url -- path )",
      "proto": "( url -- proto )",
      "port": "( url -- port )",
      "hash": "( url -- hash )",
      "param": "( url key -- val )",
      "has-param": "( url key -- 0|1 )",
      "segment": "( url idx -- seg )",
      "eq": "( a b -- 0|1 )",
      "neq": "( a b -- 0|1 )",
      "starts-with": "( str prefix -- 0|1 )",
      "ends-with": "( str suffix -- 0|1 )",
      "contains": "( str sub -- 0|1 )",
      "and": "( a b -- 0|1 )",
      "or": "( a b -- 0|1 )",
      "not": "( a -- 0|1 )",
      "concat": "( a b -- ab )",
      "replace": "( str srch rep -- newStr )",
      "replace-all": "( str srch rep -- newStr )",
      "substr": "( str start len -- subStr )",
      "set-param": "( url key val -- newUrl )",
      "remove-param": "( url key -- newUrl )",
      "split": "( str delim -- arr )",
      "param-keys": "( url -- arr )",
      "param-values": "( url -- arr )",
      "path-segments": "( url -- arr )",
      "len": "( arr -- num )",
      "get": "( arr idx -- val )",
      "join": "( arr delim -- str )",
      "indices": "( arr -- arr )",
      "slice": "( arr start num -- newArr )",
      "zip": "( arr arr -- arr )",
      "call": "( quot -- )",
      "call-if": "( flag quot -- )",
      "choose": "( flag quotT quotF -- )",
      "each": "( arr quot -- )",
      "map": "( arr quot -- newArr )",
      "filter": "( arr quot -- newArr )",
      "redirect": "( url -- )",
      "skip": "( -- )",
      "str?": "( a -- a 0|1 )",
      "int?": "( a -- a 0|1 )",
      "arr?": "( a -- a 0|1 )",
      "quot?": "( a -- a 0|1 )"
    };
  }
  // ------------------------------------------------------------------------
  // Lexer
  // ------------------------------------------------------------------------
  tokenize(source) {
    const tokens = [];
    let i = 0;
    let line = 1;
    let col = 1;
    const advance = (n = 1) => {
      for (let j = 0; j < n; j++) {
        if (source[i] === '\n') { line++; col = 1; } else { col++; }
        i++;
      }
    };
    const pushToken = (type, value) => {
      tokens.push({ type, value, line, col });
    };
    while (i < source.length) {
      const char = source[i];
      // Whitespace
      if (/\s/.test(char)) {
        advance();
        continue;
      }
      // Line Comments
      if (char === '#') {
        while (i < source.length && source[i] !== '\n') advance();
        continue;
      }
      // Inline Comments
      if (char === '(') {
        let startCol = col, startLine = line;
        advance(); // skip '('
        while (i < source.length && source[i] !== ')') advance();
        if (i >= source.length) {
          return { success: false, errors: [{ line: startLine, col: startCol, message: "Unterminated comment block" }] };
        }
        advance(); // skip ')'
        continue;
      }
      // Syntax chars
      if (char === ':') { pushToken(':', ':'); advance(); continue; }
      if (char === ';') { pushToken(';', ';'); advance(); continue; }
      if (char === '[') { pushToken('[', '['); advance(); continue; }
      if (char === ']') { pushToken(']', ']'); advance(); continue; }
      if (char === '{') { pushToken('{', '{'); advance(); continue; }
      if (char === '}') { pushToken('}', '}'); advance(); continue; }
      // Strings
      if (char === '"') {
        let startCol = col, startLine = line;
        advance(); // skip '"'
        let str = "";
        while (i < source.length) {
          if (source[i] === '"') break;
          if (source[i] === '\\' && i + 1 < source.length) {
            str += source[i + 1];
            advance(2);
          } else {
            str += source[i];
            advance();
          }
        }
        if (i >= source.length) {
          return { success: false, errors: [{ line: startLine, col: startCol, message: "Unterminated string literal" }] };
        }
        advance(); // skip closing '"'
        pushToken('STRING', str);
        continue;
      }
      // Numbers and negative numbers
      if (/[0-9]/.test(char) || (char === '-' && i + 1 < source.length && /[0-9]/.test(source[i+1]))) {
        let numStr = "";
        if (char === '-') {
          numStr = "-";
          advance();
        }
        while (i < source.length && /[0-9]/.test(source[i])) {
          numStr += source[i];
          advance();
        }
        pushToken('NUMBER', parseInt(numStr, 10));
        continue;
      }
      // Words
      if (/[a-zA-Z_$?+\-*/%><]/.test(char)) {
        let wordStr = "";
        while (i < source.length && /[a-zA-Z0-9_$\-?+\-*/%><=]/.test(source[i])) {
          wordStr += source[i];
          advance();
        }
        pushToken('WORD', wordStr);
        continue;
      }
      // Unknown char
      return { success: false, errors: [{ line, col, message: `Unexpected character: '${char}'` }] };
    }
    return { success: true, tokens };
  }
  // ------------------------------------------------------------------------
  // Interpreter
  // ------------------------------------------------------------------------
  execute(source, initialUrl) {
    const lexResult = this.tokenize(source);
    if (!lexResult.success) {
      return { success: false, error: lexResult.errors[0].message };
    }
    return this.runTokens(lexResult.tokens, initialUrl);
  }
  runTokens(tokens, initialUrl) {
    const state = {
      ip: 0,
      tokens: tokens,
      stack: [initialUrl],
      callStack: [], // [{ ip, dictionary }]
      ops: 0,
      redirectUrl: null,
      dictionary: { ...this.dictionary },
      error: null,
      maxCallStack: this.maxCallStack
    };

    try {
      this.registerWords(state);
    } catch (e) {
      return { success: false, error: e.message };
    }

    const gen = this.runGenerator(state);
    let res = gen.next();
    while (!res.done) {
      res = gen.next();
    }

    if (state.error) {
      if (state.error === "SKIP_SIGNAL") {
        return { success: true, redirect: null, stack: state.stack, ops: state.ops };
      }
      return { success: false, error: state.error };
    }
    return {
      success: true,
      redirect: state.redirectUrl,
      stack: state.stack,
      ops: state.ops
    };
  }

  static createDebugSession(tokens, initialUrl, options = {}) {
    const interpreter = new Interpreter(options);
    const state = {
      ip: 0,
      tokens: tokens,
      stack: [initialUrl],
      callStack: [],
      ops: 0,
      redirectUrl: null,
      dictionary: { ...interpreter.dictionary },
      error: null,
      maxCallStack: interpreter.maxCallStack
    };

    try {
      interpreter.registerWords(state);
    } catch (e) {
      state.error = e.message;
      return { state, done: true };
    }

    state._gen = interpreter.runGenerator(state);
    return { state, done: false };
  }

  static stepSession(session) {
    if (session.done) return session;
    const st = session.state;

    if (st.redirectUrl !== null || st.error) {
      session.done = true;
      return session;
    }

    try {
      const { done } = st._gen.next();
      if (done) session.done = true;
    } catch (e) {
      st.error = e.message;
      session.done = true;
    }

    return session;
  }

  *runGenerator(state) {
    while (state.ip < state.tokens.length && !state.error && state.redirectUrl === null) {
      if (state.ops >= this.maxOps) {
        state.error = "Op budget exceeded";
        return;
      }
      
      const token = state.tokens[state.ip];
      state._currentInstruction = (token.type === 'WORD' ? token.value : String(token.value || token.type));
      
      yield state; // Yield BEFORE execution

      state.ip++;
      state.ops++;
      
      try {
        yield* this.dispatchGen(token, state);
      } catch (e) {
        state.error = e.message;
        return;
      }
    }
  }
  registerWords(state) {
    let i = 0;
    while (i < state.tokens.length) {
      const token = state.tokens[i];
      if (token.type === ':') {
        i++;
        if (i >= state.tokens.length || state.tokens[i].type !== 'WORD') {
          throw new Error("Expected word name after ':'");
        }
        const name = state.tokens[i].value;
        i++;
        const start = i;
        let depth = 0;
        while (i < state.tokens.length) {
          if (state.tokens[i].type === ':') {
            throw new Error(`Nested word definitions are not allowed (word: '${name}')`);
          }
          if (state.tokens[i].type === ';' && depth === 0) break;
          if (state.tokens[i].type === '[') depth++;
          if (state.tokens[i].type === ']') depth--;
          i++;
        }
        if (i >= state.tokens.length) throw new Error(`Unterminated definition for word '${name}'`);
        const end = i;
        const self = this;
        state.dictionary[name] = function* (st) {
          if (st.callStack.length >= (st.maxCallStack || 16)) throw new Error("Call stack overflow");
          st.callStack.push({ ip: st.ip });
          st.ip = start;
          while (st.ip < end && !st.error && st.redirectUrl === null) {
            if (st.ops++ >= self.maxOps) throw new Error("Op budget exceeded");
            const t = st.tokens[st.ip++];
            yield* self.dispatchGen(t, st);
          }
          const frame = st.callStack.pop();
          st.ip = frame.ip;
        };
      }
      i++;
    }
  }

  *dispatchGen(token, state) {
    if (token.type === ':') {
      let depth = 0;
      while (state.ip < state.tokens.length) {
        if (state.tokens[state.ip].type === ';' && depth === 0) {
          state.ip++;
          break;
        }
        if (state.tokens[state.ip].type === '[') depth++;
        if (state.tokens[state.ip].type === ']') depth--;
        state.ip++;
      }
      return;
    }
    if (token.type === '[') {
      let depth = 1;
      const start = state.ip;
      while (state.ip < state.tokens.length && depth > 0) {
        if (state.tokens[state.ip].type === '[') depth++;
        if (state.tokens[state.ip].type === ']') depth--;
        state.ip++;
      }
      if (depth > 0) throw new Error("Unterminated quotation '['");
      this.push(state, { type: 'QUOTATION', start, end: state.ip - 1 });
      return;
    }
    if (token.type === '{') {
      const arrayStack = [[]];
      while (state.ip < state.tokens.length) {
        const pt = state.tokens[state.ip++];
        state.ops++;
        if (pt.type === '}') {
          const finishedArray = arrayStack.pop();
          if (finishedArray.length > this.maxArrayLen) finishedArray.length = this.maxArrayLen;
          if (arrayStack.length === 0) {
            this.push(state, finishedArray);
            return;
          } else {
            arrayStack[arrayStack.length - 1].push(finishedArray);
            continue;
          }
        }
        if (pt.type === '{') {
          arrayStack.push([]);
          continue;
        }
        if (pt.type === 'STRING' || pt.type === 'NUMBER') {
          arrayStack[arrayStack.length - 1].push(pt.value);
          continue;
        }
        if (pt.type === '[') {
          let depth = 1;
          const start = state.ip;
          while (state.ip < state.tokens.length && depth > 0) {
            if (state.tokens[state.ip].type === '[') depth++;
            if (state.tokens[state.ip].type === ']') depth--;
            state.ip++;
          }
          if (depth > 0) throw new Error("Unterminated quotation");
          arrayStack[arrayStack.length - 1].push({ type: 'QUOTATION', start, end: state.ip - 1 });
          continue;
        }
        throw new Error(`Invalid element in array literal: ${pt.value}`);
      }
      throw new Error("Unterminated array '{'");
    }
    if (token.type === 'STRING' || token.type === 'NUMBER') {
      this.push(state, token.value);
      return;
    }
    if (token.type === 'WORD') {
      const wordFn = state.dictionary[token.value];
      if (!wordFn) throw new Error(`Unknown word: '${token.value}'`);
      if (wordFn.constructor.name === 'GeneratorFunction') {
        yield* wordFn(state);
      } else {
        wordFn(state);
      }
      return;
    }
    throw new Error(`Unexpected token: ${token.type}`);
  }

  push(state, val) {
    if (state.stack.length >= this.maxStack) throw new Error("Stack overflow");
    if (typeof val === 'number') {
      // Force 16-bit signed integer with wrapping (2's complement)
      val = (val << 16) >> 16;
    }
    if (typeof val === 'string' && val.length > this.maxStringLen) {
      throw new Error(`String exceeds max length of ${this.maxStringLen}`);
    }
    if (Array.isArray(val) && val.length > this.maxArrayLen) {
      throw new Error(`Array exceeds max length of ${this.maxArrayLen}`);
    }
    state.stack.push(val);
  }
  pop(state) {
    if (state.stack.length === 0) throw new Error("Stack underflow");
    return state.stack.pop();
  }
  isTruthy(val) {
    if (typeof val === 'number') return val !== 0;
    if (typeof val === 'string') return val.length > 0;
    if (Array.isArray(val)) return val.length > 0;
    if (val && val.type === 'QUOTATION') return true;
    return false;
  }
  *execQuotation(state, quot) {
    if (!quot || quot.type !== 'QUOTATION') throw new Error("Expected quotation");
    if (state.callStack.length >= (state.maxCallStack || 16)) throw new Error("Call stack overflow");
    const savedIp = state.ip;
    state.ip = quot.start;
    state.callStack.push({ ip: savedIp });
    while (state.ip < quot.end && !state.error && state.redirectUrl === null) {
      if (state.ops++ >= this.maxOps) throw new Error("Op budget exceeded");
      const t = state.tokens[state.ip++];
      yield* this.dispatchGen(t, state);
    }
    const frame = state.callStack.pop();
    state.ip = frame.ip;
  }

  // ------------------------------------------------------------------------
  // Built-in Words Dictionary
  // ------------------------------------------------------------------------
  buildIns() {
    const d = Object.create(null);
    // Helper to register simple synchronous words
    const sync = (fn) => { return (st, next) => { fn(st); return next; }; };
    // Stack
    d['dup'] = sync(s => { const v = this.pop(s); this.push(s, v); this.push(s, v); });
    d['drop'] = sync(s => this.pop(s));
    d['swap'] = sync(s => { const a = this.pop(s), b = this.pop(s); this.push(s, a); this.push(s, b); });
    d['over'] = sync(s => { const a = this.pop(s), b = this.pop(s); this.push(s, b); this.push(s, a); this.push(s, b); });
    d['rot'] = sync(s => { const a = this.pop(s), b = this.pop(s), c = this.pop(s); this.push(s, b); this.push(s, a); this.push(s, c); });
    d['$t'] = sync(s => { const a = this.pop(s); this.push(s, a); this.push(s, a); }); // Peek top
    // URL parsing helper
    const parseUrl = (str) => {
      try {
        return new URL(str);
      } catch {
        return null;
      }
    };
    // URL Decomposition
    d['host'] = sync(s => { const u = parseUrl(this.pop(s)); this.push(s, u ? u.hostname : ""); });
    d['path'] = sync(s => { const u = parseUrl(this.pop(s)); this.push(s, u ? u.pathname : ""); });
    d['proto'] = sync(s => { const u = parseUrl(this.pop(s)); this.push(s, u ? u.protocol.replace(':', '') : ""); });
    d['port'] = sync(s => { const u = parseUrl(this.pop(s)); this.push(s, u ? u.port : ""); });
    d['hash'] = sync(s => { const u = parseUrl(this.pop(s)); this.push(s, u ? u.hash.replace('#', '') : ""); });
    d['param'] = sync(s => {
      const k = this.pop(s), urlStr = this.pop(s);
      const u = parseUrl(urlStr);
      this.push(s, u && u.searchParams.has(k) ? u.searchParams.get(k) : "");
    });
    d['has-param'] = sync(s => {
      const k = this.pop(s), urlStr = this.pop(s);
      const u = parseUrl(urlStr);
      this.push(s, u && u.searchParams.has(k) ? 1 : 0);
    });
    d['segment'] = sync(s => {
      const n = this.pop(s), urlStr = this.pop(s);
      const u = parseUrl(urlStr);
      if (!u) { this.push(s, ""); return; }
      const segs = u.pathname.split('/').filter(x => x);
      this.push(s, (typeof n === 'number' && n >= 0 && n < segs.length) ? segs[n] : "");
    });
    // Comparison
    d['eq'] = sync(s => { const a = this.pop(s), b = this.pop(s); this.push(s, a === b ? 1 : 0); });
    d['neq'] = sync(s => { const a = this.pop(s), b = this.pop(s); this.push(s, a !== b ? 1 : 0); });
    d['>'] = sync(s => { const b = this.pop(s), a = this.pop(s); this.push(s, a > b ? 1 : 0); });
    d['<'] = sync(s => { const b = this.pop(s), a = this.pop(s); this.push(s, a < b ? 1 : 0); });
    d['>='] = sync(s => { const b = this.pop(s), a = this.pop(s); this.push(s, a >= b ? 1 : 0); });
    d['<='] = sync(s => { const b = this.pop(s), a = this.pop(s); this.push(s, a <= b ? 1 : 0); });
    d['starts-with'] = sync(s => { const p = this.pop(s), v = this.pop(s); this.push(s, typeof v === 'string' && v.startsWith(p) ? 1 : 0); });
    d['ends-with'] = sync(s => { const p = this.pop(s), v = this.pop(s); this.push(s, typeof v === 'string' && v.endsWith(p) ? 1 : 0); });
    d['contains'] = sync(s => { const n = this.pop(s), h = this.pop(s); this.push(s, typeof h === 'string' && h.includes(n) ? 1 : 0); });
    // Logic
    d['and'] = sync(s => { const a = this.pop(s), b = this.pop(s); this.push(s, (this.isTruthy(a) && this.isTruthy(b)) ? 1 : 0); });
    d['or'] = sync(s => { const a = this.pop(s), b = this.pop(s); this.push(s, (this.isTruthy(a) || this.isTruthy(b)) ? 1 : 0); });
    d['not'] = sync(s => { const a = this.pop(s); this.push(s, !this.isTruthy(a) ? 1 : 0); });
    // Arithmetic
    d['+'] = sync(s => { const b = this.pop(s), a = this.pop(s); this.push(s, a + b); });
    d['-'] = sync(s => { const b = this.pop(s), a = this.pop(s); this.push(s, a - b); });
    d['*'] = sync(s => { const b = this.pop(s), a = this.pop(s); this.push(s, a * b); });
    d['/'] = sync(s => {
      const b = this.pop(s), a = this.pop(s);
      if (b === 0) throw new Error("Division by zero");
      this.push(s, Math.trunc(a / b));
    });
    d['%'] = sync(s => {
      const b = this.pop(s), a = this.pop(s);
      if (b === 0) throw new Error("Division by zero");
      this.push(s, a % b);
    });
    // Type predicates (non-destructive: peek top, push flag)
    d['str?'] = sync(s => { const v = s.stack[s.stack.length - 1]; this.push(s, typeof v === 'string' ? 1 : 0); });
    d['int?'] = sync(s => { const v = s.stack[s.stack.length - 1]; this.push(s, typeof v === 'number' ? 1 : 0); });
    d['arr?'] = sync(s => { const v = s.stack[s.stack.length - 1]; this.push(s, Array.isArray(v) ? 1 : 0); });
    d['quot?'] = sync(s => { const v = s.stack[s.stack.length - 1]; this.push(s, (v !== null && typeof v === 'object' && v.type === 'QUOTATION') ? 1 : 0); });
    // String
    d['concat'] = sync(s => { const b = this.pop(s), a = this.pop(s); this.push(s, String(a) + String(b)); });
    d['replace'] = sync(s => { const r = this.pop(s), srch = this.pop(s), str = this.pop(s); this.push(s, String(str).replace(srch, r)); });
    d['replace-all'] = sync(s => { const r = this.pop(s), srch = this.pop(s), str = this.pop(s); this.push(s, String(str).split(srch).join(r)); });
    d['substr'] = sync(s => { const l = this.pop(s), st = this.pop(s), str = this.pop(s); this.push(s, String(str).substring(st, st + l)); });
    // URL Mutation
    d['set-param'] = sync(s => {
      const v = this.pop(s), k = this.pop(s), urlStr = this.pop(s);
      const u = parseUrl(urlStr);
      if (!u) { this.push(s, urlStr); return; }
      u.searchParams.set(k, v);
      this.push(s, u.toString());
    });
    d['remove-param'] = sync(s => {
      const k = this.pop(s), urlStr = this.pop(s);
      const u = parseUrl(urlStr);
      if (!u) { this.push(s, urlStr); return; }
      u.searchParams.delete(k);
      this.push(s, u.toString());
    });
    // String -> Array
    d['split'] = sync(s => { const delim = this.pop(s), str = this.pop(s); this.push(s, String(str).split(delim)); });
    d['param-keys'] = sync(s => {
      const u = parseUrl(this.pop(s));
      this.push(s, u ? Array.from(u.searchParams.keys()) : []);
    });
    d['param-values'] = sync(s => {
      const u = parseUrl(this.pop(s));
      this.push(s, u ? Array.from(u.searchParams.values()) : []);
    });
    d['path-segments'] = sync(s => {
      const u = parseUrl(this.pop(s));
      this.push(s, u ? u.pathname.split('/').filter(x => x) : []);
    });
    // Array
    d['len'] = sync(s => { const arr = this.pop(s); this.push(s, Array.isArray(arr) ? arr.length : 0); });
    d['get'] = sync(s => {
      const idx = this.pop(s), arr = this.pop(s);
      this.push(s, Array.isArray(arr) ? arr[idx] : null);
    });
    d['join'] = sync(s => { const d = this.pop(s), arr = this.pop(s); this.push(s, Array.isArray(arr) ? arr.join(d) : ""); });
    d['indices'] = sync(s => { const arr = this.pop(s); this.push(s, Array.isArray(arr) ? arr.map((_, i) => i) : []); });
    d['slice'] = sync(s => {
      const count = this.pop(s), start = this.pop(s), arr = this.pop(s);
      this.push(s, Array.isArray(arr) ? arr.slice(start, start + count) : []);
    });
    d['zip'] = sync(s => {
      const b = this.pop(s), a = this.pop(s);
      if (!Array.isArray(a) || !Array.isArray(b)) { this.push(s, []); return; }
      const len = Math.min(a.length, b.length);
      this.push(s, Array.from({ length: len }, (_, i) => [a[i], b[i]]));
    });
    // Combinators
    d['call'] = function* (s) {
      const quot = this.pop(s);
      yield* this.execQuotation(s, quot);
    }.bind(this);
    d['call-if'] = function* (s) {
      const quot = this.pop(s);
      const flag = this.pop(s);
      if (this.isTruthy(flag)) {
        yield* this.execQuotation(s, quot);
      }
    }.bind(this);
    d['choose'] = function* (s) {
      const qf = this.pop(s);
      const qt = this.pop(s);
      const flag = this.pop(s);
      yield* this.execQuotation(s, this.isTruthy(flag) ? qt : qf);
    }.bind(this);
    d['each'] = function* (s) {
      const quot = this.pop(s);
      const arr = this.pop(s);
      if (!Array.isArray(arr)) return;
      for (const item of arr) {
        if (s.error || s.redirectUrl !== null) break;
        this.push(s, item);
        yield* this.execQuotation(s, quot);
      }
    }.bind(this);
    d['map'] = function* (s) {
      const quot = this.pop(s);
      const arr = this.pop(s);
      if (!Array.isArray(arr)) { this.push(s, []); return; }
      const res = [];
      for (const item of arr) {
        if (s.error || s.redirectUrl !== null) break;
        this.push(s, item);
        yield* this.execQuotation(s, quot);
        res.push(this.pop(s));
      }
      if (!s.error && s.redirectUrl === null) this.push(s, res);
    }.bind(this);
    d['filter'] = function* (s) {
      const quot = this.pop(s);
      const arr = this.pop(s);
      if (!Array.isArray(arr)) { this.push(s, []); return; }
      const res = [];
      for (const item of arr) {
        if (s.error || s.redirectUrl !== null) break;
        this.push(s, item);
        yield* this.execQuotation(s, quot);
        if (this.isTruthy(this.pop(s))) res.push(item);
      }
      if (!s.error && s.redirectUrl === null) this.push(s, res);
    }.bind(this);
    // Termination
    d['redirect'] = sync(s => {
      const url = this.pop(s);
      s.redirectUrl = url; // halts the trampoline
    });
    d['skip'] = sync(s => {
      s.redirectUrl = null;
      s.error = "SKIP_SIGNAL"; // internal flag to trigger graceful exit
    });
    return d;
  }
}
