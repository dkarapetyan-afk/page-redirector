// Page Redirector - Stack Language Interpreter
// Implements the CPS-trampolined VM specified in vm-spec.md


export class Interpreter {
  constructor(options = {}) {
    this.maxOps = options.maxOps || 1024;
    this.maxStack = 64;
    this.maxCallStack = 16;
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
      "call": "( quot -- )",
      "call-if": "( flag quot -- )",
      "choose": "( flag quotT quotF -- )",
      "each": "( arr quot -- )",
      "map": "( arr quot -- newArr )",
      "filter": "( arr quot -- newArr )",
      "redirect": "( url -- )",
      "skip": "( -- )"
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
      if (char === ':') { pushToken('COLON', ':'); advance(); continue; }
      if (char === ';') { pushToken('SEMICOLON', ';'); advance(); continue; }
      if (char === '[') { pushToken('OPEN_BRACKET', '['); advance(); continue; }
      if (char === ']') { pushToken('CLOSE_BRACKET', ']'); advance(); continue; }
      if (char === '{') { pushToken('OPEN_BRACE', '{'); advance(); continue; }
      if (char === '}') { pushToken('CLOSE_BRACE', '}'); advance(); continue; }

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
        pushToken('STRING', str.toLowerCase());
        continue;
      }

      // Numbers
      if (/[0-9]/.test(char)) {
        let numStr = "";
        while (i < source.length && /[0-9]/.test(source[i])) {
          numStr += source[i];
          advance();
        }
        pushToken('NUMBER', parseInt(numStr, 10));
        continue;
      }

      // Words
      if (/[a-zA-Z_$]/.test(char)) {
        let wordStr = "";
        while (i < source.length && /[a-zA-Z0-9_$-]/.test(source[i])) {
          wordStr += source[i];
          advance();
        }
        pushToken('WORD', wordStr.toLowerCase());
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
      callStack: [], // { ip, dict }
      ops: 0,
      redirectUrl: null,
      dictionary: { ...this.dictionary }, // Scope clone for this run (for words)
      error: null
    };

    // First pass: register word definitions
    try {
      this.registerWords(state);
    } catch (e) {
      return { success: false, error: e.message };
    }

    const self = this;

    // The inner CPS step function
    function next() {
      if (state.error || state.redirectUrl !== null || state.ip >= state.tokens.length) {
        return null; // Halt
      }
      if (state.ops >= self.maxOps) {
        state.error = "Op budget exceeded";
        return null;
      }

      const token = state.tokens[state.ip++];
      state.ops++;

      return () => self.dispatch(token, state, next);
    }

    // Trampoline loop
    let thunk = next;
    while (typeof thunk === 'function') {
      try {
        thunk = thunk();
      } catch (e) {
        state.error = e.message;
        break;
      }
    }

    if (state.error) {
      if (state.error === "SKIP_SIGNAL") {
        return { success: true, redirect: null, ops: state.ops };
      }
      return { success: false, error: state.error };
    }

    return {
      success: true,
      redirect: state.redirectUrl, // null means SKIP, string means REDIRECT
      ops: state.ops
    };
  }

  createDebugSession(tokens, initialUrl) {
    const state = {
      ip: 0,
      tokens: tokens,
      stack: [initialUrl],
      callStack: [], 
      ops: 0,
      redirectUrl: null,
      dictionary: { ...this.dictionary },
      error: null
    };

    try {
      this.registerWords(state);
    } catch (e) {
      state.error = e.message;
      return { state, thunk: null, done: true };
    }

    const self = this;
    function next() {
      if (state.error || state.redirectUrl !== null || state.ip >= state.tokens.length) {
        return null;
      }
      if (state.ops >= self.maxOps) {
        state.error = "Op budget exceeded";
        return null;
      }

      state._currentInstruction = state.tokens[state.ip].type === 'WORD' 
            ? state.tokens[state.ip].value 
            : String(state.tokens[state.ip].value || state.tokens[state.ip].type);

      const token = state.tokens[state.ip++];
      state.ops++;

      return () => self.dispatch(token, state, next);
    }

    return { state, thunk: next, done: false };
  }

  stepSession(session) {
    if (session.done || !session.thunk) {
      session.done = true;
      return session;
    }
    
    try {
      session.thunk = session.thunk();
      if (!session.thunk) session.done = true;
    } catch (e) {
      session.state.error = e.message;
      session.done = true;
    }
    
    return session;
  }

  registerWords(state) {
    let i = 0;
    while (i < state.tokens.length) {
      const token = state.tokens[i];
      if (token.type === 'COLON') {
        i++;
        if (i >= state.tokens.length || state.tokens[i].type !== 'WORD') {
          throw new Error("Expected word name after ':'");
        }
        const name = state.tokens[i].value;
        i++;
        const start = i;

        // Scan to semicolon
        let depth = 0; // handle nested structures just in case
        while (i < state.tokens.length) {
          if (state.tokens[i].type === 'COLON') {
            throw new Error(`Nested word definitions are not allowed (word: '${name}')`);
          }
          if (state.tokens[i].type === 'SEMICOLON' && depth === 0) break;
          // Note: words shouldn't nest, but bracket quotes inside words do
          if (state.tokens[i].type === 'OPEN_BRACKET') depth++;
          if (state.tokens[i].type === 'CLOSE_BRACKET') depth--;
          i++;
        }

        if (i >= state.tokens.length) {
          throw new Error(`Unterminated definition for word '${name}'`);
        }
        if (depth !== 0) {
          throw new Error(`Unbalanced brackets in definition for word '${name}'`);
        }

        if (this.dictionary[name]) {
          console.warn(`VM Warning: Word definition for '${name}' overrides a built-in word.`);
        }

        // Register in dictionary: a custom word is just a function that sets up the call stack and jumps
        const end = i;
        const self = this;
        state.dictionary[name] = (st, next) => {
          if (st.callStack.length >= this.maxCallStack) {
            throw new Error("Call stack overflow");
          }
          st.callStack.push({ ip: st.ip });
          st.ip = start;

          function runWordBody() {
            if (st.ip >= end || st.ops >= self.maxOps || st.redirectUrl !== null || st.error) {
              const frame = st.callStack.pop();
              st.ip = frame.ip;
              return () => next();
            }
            const t = st.tokens[st.ip++];
            st.ops++;
            return () => self.dispatch(t, st, runWordBody);
          }
          return () => runWordBody();
        };
      }
      i++;
    }
  }

  dispatch(token, state, next) {
    if (token.type === 'COLON') {
      // Skip over definition body (already registered in registerWords)
      let depth = 0;
      while (state.ip < state.tokens.length) {
        if (state.tokens[state.ip].type === 'SEMICOLON' && depth === 0) {
          state.ip++; // skip semicolon
          break;
        }
        if (state.tokens[state.ip].type === 'OPEN_BRACKET') depth++;
        if (state.tokens[state.ip].type === 'CLOSE_BRACKET') depth--;
        state.ip++;
      }
      return () => next();
    }

    if (token.type === 'OPEN_BRACKET') {
      // Scan for closing bracket to construct quotation reference
      let depth = 1;
      const start = state.ip;
      while (state.ip < state.tokens.length && depth > 0) {
        if (state.tokens[state.ip].type === 'OPEN_BRACKET') depth++;
        if (state.tokens[state.ip].type === 'CLOSE_BRACKET') depth--;
        state.ip++;
      }
      if (depth > 0) throw new Error("Unterminated quotation '['");
      const end = state.ip - 1; // point to CLOSE_BRACKET
      this.push(state, { type: 'QUOTATION', start, end });
      return () => next();
    }

    if (token.type === 'OPEN_BRACE') {
      // Array literal - evaluates elements until CLOSE_BRACE
      const arrayStack = [[]];
      const self = this;

      function readElement() {
        if (state.ip >= state.tokens.length) {
          state.error = "Unterminated array '{'";
          return null;
        }
        const pt = state.tokens[state.ip++];
        state.ops++;

        if (pt.type === 'CLOSE_BRACE') {
          const finishedArray = arrayStack.pop();
          if (finishedArray.length > self.maxArrayLen) finishedArray.length = self.maxArrayLen;
          
          if (arrayStack.length === 0) {
              self.push(state, finishedArray);
              return () => next();
          } else {
              arrayStack[arrayStack.length - 1].push(finishedArray);
              return () => readElement();
          }
        }
        
        if (pt.type === 'OPEN_BRACE') {
            arrayStack.push([]);
            return () => readElement();
        }

        if (pt.type === 'STRING' || pt.type === 'NUMBER') {
          arrayStack[arrayStack.length - 1].push(pt.value);
          return () => readElement();
        }

        if (pt.type === 'OPEN_BRACKET') {
          // Quotations inside arrays
          let depth = 1;
          const start = state.ip;
          while (state.ip < state.tokens.length && depth > 0) {
            if (state.tokens[state.ip].type === 'OPEN_BRACKET') depth++;
            if (state.tokens[state.ip].type === 'CLOSE_BRACKET') depth--;
            state.ip++;
          }
          if (depth > 0) { state.error = "Unterminated quotation"; return null; }
          arrayStack[arrayStack.length - 1].push({ type: 'QUOTATION', start, end: state.ip - 1 });
          return () => readElement();
        }

        state.error = `Invalid element in array literal: ${pt.value}`;
        return null;
      }
      return () => readElement();
    }

    if (token.type === 'STRING' || token.type === 'NUMBER') {
      this.push(state, token.value);
      return () => next();
    }

    if (token.type === 'WORD') {
      const wordFn = state.dictionary[token.value];
      if (!wordFn) {
        throw new Error(`Unknown word: '${token.value}'`);
      }
      return wordFn(state, next);
    }

    throw new Error(`Unexpected token: ${token.type}`);
  }

  // ------------------------------------------------------------------------
  // Stack Helpers
  // ------------------------------------------------------------------------

  push(state, val) {
    if (state.stack.length >= this.maxStack) throw new Error("Stack overflow");
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

  // Executing a quotation (used by combinators)
  execQuotation(state, quot, next) {
    if (!quot || quot.type !== 'QUOTATION') throw new Error("Expected quotation");
    if (state.callStack.length >= this.maxCallStack) throw new Error("Call stack overflow");

    const savedIp = state.ip;
    state.ip = quot.start;
    state.callStack.push({ ip: savedIp });

    const self = this;
    function runQuotBody() {
      if (state.ip >= quot.end || state.ops >= self.maxOps || state.redirectUrl !== null || state.error) {
        const frame = state.callStack.pop();
        state.ip = frame.ip;
        return () => next();
      }
      const t = state.tokens[state.ip++];
      state.ops++;
      return () => self.dispatch(t, state, runQuotBody);
    }

    return () => runQuotBody();
  }

  // ------------------------------------------------------------------------
  // Built-in Words Dictionary
  // ------------------------------------------------------------------------

  buildIns() {
    const d = Object.create(null);

    // Helper to register simple synchronous words
    const sync = (fn) => { return (st, next) => { fn(st); return () => next(); }; };

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
    d['starts-with'] = sync(s => { const p = this.pop(s), v = this.pop(s); this.push(s, typeof v === 'string' && v.startsWith(p) ? 1 : 0); });
    d['ends-with'] = sync(s => { const p = this.pop(s), v = this.pop(s); this.push(s, typeof v === 'string' && v.endsWith(p) ? 1 : 0); });
    d['contains'] = sync(s => { const n = this.pop(s), h = this.pop(s); this.push(s, typeof h === 'string' && h.includes(n) ? 1 : 0); });

    // Logic
    d['and'] = sync(s => { const a = this.pop(s), b = this.pop(s); this.push(s, (this.isTruthy(a) && this.isTruthy(b)) ? 1 : 0); });
    d['or'] = sync(s => { const a = this.pop(s), b = this.pop(s); this.push(s, (this.isTruthy(a) || this.isTruthy(b)) ? 1 : 0); });
    d['not'] = sync(s => { const a = this.pop(s); this.push(s, !this.isTruthy(a) ? 1 : 0); });

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
      this.push(s, (Array.isArray(arr) && idx >= 0 && idx < arr.length) ? arr[idx] : "");
    });
    d['join'] = sync(s => { const d = this.pop(s), arr = this.pop(s); this.push(s, Array.isArray(arr) ? arr.join(d) : ""); });
    d['indices'] = sync(s => { const arr = this.pop(s); this.push(s, Array.isArray(arr) ? arr.map((_, i) => i) : []); });
    d['slice'] = sync(s => {
      const count = this.pop(s), start = this.pop(s), arr = this.pop(s);
      this.push(s, Array.isArray(arr) ? arr.slice(start, start + count) : []);
    });

    // Combinators
    d['call'] = (s, next) => {
      const quot = this.pop(s);
      return this.execQuotation(s, quot, next);
    };
    d['call-if'] = (s, next) => {
      const quot = this.pop(s);
      const flag = this.pop(s);
      if (this.isTruthy(flag)) {
        return this.execQuotation(s, quot, next);
      }
      return () => next();
    };
    d['choose'] = (s, next) => {
      const qf = this.pop(s);
      const qt = this.pop(s);
      const flag = this.pop(s);
      return this.execQuotation(s, this.isTruthy(flag) ? qt : qf, next);
    };

    d['each'] = (s, next) => {
      const quot = this.pop(s);
      const arr = this.pop(s);
      if (!Array.isArray(arr)) return () => next();

      let i = 0;
      const step = () => {
        if (i >= arr.length) return () => next();
        this.push(s, arr[i++]);
        return this.execQuotation(s, quot, step);
      };
      return step;
    };

    d['map'] = (s, next) => {
      const quot = this.pop(s);
      const arr = this.pop(s);
      if (!Array.isArray(arr)) { this.push(s, []); return () => next(); }

      let i = 0;
      const res = [];
      const step = () => {
        if (i >= arr.length) {
          this.push(s, res);
          return () => next();
        }
        this.push(s, arr[i++]);
        return this.execQuotation(s, quot, () => {
          res.push(this.pop(s));
          return step();
        });
      };
      return step;
    };

    d['filter'] = (s, next) => {
      const quot = this.pop(s);
      const arr = this.pop(s);
      if (!Array.isArray(arr)) { this.push(s, []); return () => next(); }

      let i = 0;
      const res = [];
      const step = () => {
        if (i >= arr.length) {
          this.push(s, res);
          return () => next();
        }
        const elem = arr[i++];
        this.push(s, elem);
        return this.execQuotation(s, quot, () => {
          const flag = this.pop(s);
          if (this.isTruthy(flag)) res.push(elem);
          return step();
        });
      };
      return step;
    };

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
