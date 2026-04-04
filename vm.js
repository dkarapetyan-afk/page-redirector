import { Op, OpReverseMap } from './opcodes.js';

export class VM {
  static execute(bytecode, constants, initialUrl, options = {}) {
    const stack = [initialUrl];
    let redirectUrl = null;
    let ops = 0;
    const maxOps = options.maxOps || 10000;
    const maxCallStack = options.maxCallStack || 16;
    const callStack = [];

    try {
      run(0);
    } catch (e) {
      return { success: false, error: e.message };
    }
    return { success: true, redirect: redirectUrl, stack, ops };

    function run(startIp) {
      let ip = startIp;
      while (ip < bytecode.length || callStack.length > 0) {
        if (ip >= bytecode.length) {
          if (callStack.length === 0) break;
          handleReturn();
          continue;
        }

        if (ops++ > maxOps) throw new Error("Maximum operations exceeded");
        const op = bytecode[ip++];

        switch (op) {
          case Op.PUSH_INT: stack.push(bytecode[ip++]); break;
          case Op.PUSH_STR: stack.push(constants[bytecode[ip++]]); break;
          case Op.JUMP: ip = bytecode[ip++]; break;
          case Op.PUSH_BLOCK: stack.push(bytecode[ip++]); break;
          case Op.RETURN: {
            if (callStack.length === 0) return;
            handleReturn();
            break;
          }
          case Op.CALL_CUSTOM: {
            if (callStack.length >= maxCallStack) throw new Error("Call stack overflow");
            const tgt = bytecode[ip++];
            callStack.push(ip);
            ip = tgt;
            break;
          }
          case Op.MAKE_ARRAY: {
            const len = bytecode[ip++];
            const arr = len > 0 ? stack.splice(-len) : [];
            stack.push(arr);
            break;
          }
          case Op.DUP: {
            if (stack.length < 1) throw new Error("Stack underflow");
            stack.push(stack[stack.length - 1]);
            break;
          }
          case Op.DROP: stack.pop(); break;
          case Op.SWAP: {
            const y = stack.pop(), x = stack.pop();
            stack.push(y, x);
            break;
          }
          case Op.OVER: {
            const y = stack.pop(), x = stack.pop();
            stack.push(x, y, x);
            break;
          }
          case Op.ROT: {
            const z = stack.pop(), y = stack.pop(), x = stack.pop();
            stack.push(y, z, x);
            break;
          }
          case Op.T: stack.push(stack[stack.length - 1]); break;
          case Op.HOST: stack.push(new URL(stack.pop()).hostname); break;
          case Op.PATH: stack.push(new URL(stack.pop()).pathname); break;
          case Op.PROTO: stack.push(new URL(stack.pop()).protocol.replace(":", "")); break;
          case Op.PORT: stack.push(new URL(stack.pop()).port || ""); break;
          case Op.HASH: stack.push(new URL(stack.pop()).hash.replace("#", "")); break;
          case Op.PARAM: {
            const key = stack.pop();
            stack.push(new URL(stack.pop()).searchParams.get(key) || "");
            break;
          }
          case Op.HAS_PARAM: {
            const key = stack.pop();
            stack.push(new URL(stack.pop()).searchParams.has(key) ? 1 : 0);
            break;
          }
          case Op.SEGMENT: {
            const idx = stack.pop();
            const segs = new URL(stack.pop()).pathname.split('/').filter(s => s.length > 0);
            stack.push(segs[idx] || "");
            break;
          }
          case Op.EQ: {
            const b = stack.pop();
            stack.push(stack.pop() === b ? 1 : 0);
            break;
          }
          case Op.NEQ: {
            const b = stack.pop();
            stack.push(stack.pop() !== b ? 1 : 0);
            break;
          }
          case Op.STARTS_WITH: {
            const pfx = stack.pop();
            stack.push(String(stack.pop()).startsWith(String(pfx)) ? 1 : 0);
            break;
          }
          case Op.ENDS_WITH: {
            const sfx = stack.pop();
            stack.push(String(stack.pop()).endsWith(String(sfx)) ? 1 : 0);
            break;
          }
          case Op.CONTAINS: {
            const sub = stack.pop();
            stack.push(String(stack.pop()).includes(String(sub)) ? 1 : 0);
            break;
          }
          case Op.AND: {
            const b = stack.pop(), a = stack.pop();
            stack.push((a && b) ? 1 : 0);
            break;
          }
          case Op.OR: {
            const b = stack.pop(), a = stack.pop();
            stack.push((a || b) ? 1 : 0);
            break;
          }
          case Op.NOT: stack.push(!stack.pop() ? 1 : 0); break;
          case Op.STR_Q: {
            const v = stack[stack.length - 1];
            stack.push(typeof v === 'string' ? 1 : 0);
            break;
          }
          case Op.INT_Q: {
            const v = stack[stack.length - 1];
            stack.push(typeof v === 'number' ? 1 : 0);
            break;
          }
          case Op.ARR_Q: {
            const v = stack[stack.length - 1];
            stack.push(Array.isArray(v) ? 1 : 0);
            break;
          }
          case Op.QUOT_Q: {
            const v = stack[stack.length - 1];
            stack.push((v !== null && typeof v === 'object' && v.type === 'QUOTATION') || typeof v === 'number' ? 1 : 0);
            break;
          }
          case Op.CONCAT: {
            const b = stack.pop();
            stack.push(String(stack.pop()) + String(b));
            break;
          }
          case Op.REPLACE: {
            const rep = stack.pop(), srch = stack.pop();
            stack.push(String(stack.pop()).replace(String(srch), String(rep)));
            break;
          }
          case Op.REPLACE_ALL: {
            const rep = stack.pop(), srch = stack.pop();
            stack.push(String(stack.pop()).split(String(srch)).join(String(rep)));
            break;
          }
          case Op.SUBSTR: {
            const l = stack.pop(), i = stack.pop();
            stack.push(String(stack.pop()).substr(i, l));
            break;
          }
          case Op.SET_PARAM: {
            const v = stack.pop(), k = stack.pop();
            let u = new URL(stack.pop());
            u.searchParams.set(k, v);
            stack.push(u.toString());
            break;
          }
          case Op.REMOVE_PARAM: {
            const k = stack.pop();
            let u = new URL(stack.pop());
            u.searchParams.delete(k);
            stack.push(u.toString());
            break;
          }
          case Op.SPLIT: {
            const d = stack.pop();
            stack.push(String(stack.pop()).split(String(d)));
            break;
          }
          case Op.PARAM_KEYS: stack.push(Array.from(new URL(stack.pop()).searchParams.keys())); break;
          case Op.PARAM_VALUES: stack.push(Array.from(new URL(stack.pop()).searchParams.values())); break;
          case Op.PATH_SEGMENTS: stack.push(new URL(stack.pop()).pathname.split('/').filter(x => x.length > 0)); break;
          case Op.LEN: {
            const a = stack.pop();
            stack.push(Array.isArray(a) ? a.length : 0);
            break;
          }
          case Op.GET: {
            const i = stack.pop(), a = stack.pop();
            stack.push(Array.isArray(a) ? a[i] : null);
            break;
          }
          case Op.JOIN: {
            const d = stack.pop(), a = stack.pop();
            stack.push(Array.isArray(a) ? a.join(d) : String(a));
            break;
          }
          case Op.INDICES: {
            const a = stack.pop();
            stack.push(Array.isArray(a) ? a.map((_, i) => i) : []);
            break;
          }
          case Op.SLICE: {
            const n = stack.pop(), s = stack.pop(), a = stack.pop();
            stack.push(Array.isArray(a) ? a.slice(s, s + n) : []);
            break;
          }
          case Op.ZIP: {
            const b = stack.pop(), a = stack.pop();
            if (!Array.isArray(a) || !Array.isArray(b)) { stack.push([]); break; }
            const len = Math.min(a.length, b.length);
            stack.push(Array.from({ length: len }, (_, i) => [a[i], b[i]]));
            break;
          }
          case Op.CALL: {
            if (callStack.length >= maxCallStack) throw new Error("Call stack overflow");
            const pushIp = stack.pop();
            callStack.push(ip);
            ip = pushIp;
            break;
          }
          case Op.CALL_IF: {
            const pushIp = stack.pop(), flag = stack.pop();
            if (flag) {
              if (callStack.length >= maxCallStack) throw new Error("Call stack overflow");
              callStack.push(ip);
              ip = pushIp;
            }
            break;
          }
          case Op.CHOOSE: {
            const fIp = stack.pop(), tIp = stack.pop(), flag = stack.pop();
            if (callStack.length >= maxCallStack) throw new Error("Call stack overflow");
            callStack.push(ip);
            ip = flag ? tIp : fIp;
            break;
          }
          case Op.EACH: {
            const blockIp = stack.pop(), arr = stack.pop();
            if (!Array.isArray(arr) || arr.length === 0) break;
            if (callStack.length >= maxCallStack) throw new Error("Call stack overflow");
            callStack.push({ type: 'EACH', blockIp, returnIp: ip, arr, index: 0 });
            stack.push(arr[0]);
            ip = blockIp;
            break;
          }
          case Op.MAP: {
            const blockIp = stack.pop(), arr = stack.pop();
            if (!Array.isArray(arr) || arr.length === 0) { stack.push([]); break; }
            if (callStack.length >= maxCallStack) throw new Error("Call stack overflow");
            callStack.push({ type: 'MAP', blockIp, returnIp: ip, arr, index: 0, results: [] });
            stack.push(arr[0]);
            ip = blockIp;
            break;
          }
          case Op.FILTER: {
            const blockIp = stack.pop(), arr = stack.pop();
            if (!Array.isArray(arr) || arr.length === 0) { stack.push([]); break; }
            if (callStack.length >= maxCallStack) throw new Error("Call stack overflow");
            callStack.push({ type: 'FILTER', blockIp, returnIp: ip, arr, index: 0, results: [] });
            stack.push(arr[0]);
            ip = blockIp;
            break;
          }
          case Op.REDIRECT: {
            redirectUrl = stack.pop();
            return;
          }
          case Op.SKIP: return;
          default: throw new Error(`Unknown opcode: ${op}`);
        }
        if (redirectUrl) return;
      }

      function handleReturn() {
        const frame = callStack.pop();
        if (typeof frame === 'number') {
          ip = frame;
        } else {
          // Higher-order word iteration
          let res;
          if (frame.type === 'MAP' || frame.type === 'FILTER') {
            res = stack.pop();
          }
          if (frame.type === 'FILTER') {
            if (res) frame.results.push(frame.arr[frame.index]);
          } else if (frame.type === 'MAP') {
            frame.results.push(res);
          }
          frame.index++;
          if (frame.index < frame.arr.length) {
            callStack.push(frame); // Keep iterating
            stack.push(frame.arr[frame.index]);
            ip = frame.blockIp;
          } else {
            // Iteration finished
            if (frame.type === 'MAP' || frame.type === 'FILTER') {
              stack.push(frame.results);
            }
            ip = frame.returnIp;
          }
        }
      }
    }
  }
  static createDebugSession(bytecode, constants, initialUrl) {
    const st = {
      ip: 0,
      bytecode,
      constants,
      stack: [initialUrl],
      callStack: [],
      redirectUrl: null,
      ops: 0,
      error: null,
      _currentInstruction: "",
      _cont: null
    };
    st._cont = makeRunCont(st, 0, () => null);
    return { state: st, done: false };
  }

  static stepSession(session) {
    if (session.done) return session;
    const st = session.state;

    if (st.redirectUrl !== null || st.error) {
      session.done = true;
      return session;
    }
    if (st.ops >= 10000) {
      st.error = "Maximum operations exceeded";
      session.done = true;
      return session;
    }

    try {
      const next = st._cont();
      if (next === null) {
        session.done = true;
      } else {
        st._cont = next;
      }
    } catch (e) {
      st.error = e.message;
      session.done = true;
    }

    return session;
  }
}

/* ── CPS continuation builder for the step debugger ───────────────── */

function makeRunCont(st, startIp, onDone) {
  let ip = startIp;
  const callStack = st.callStack; // Use shared callStack from state

  function step() {
    if (ip >= st.bytecode.length) return onDone();

    const op = st.bytecode[ip++];
    st.ops++;

    // Expose frame state for the debugger UI
    st.ip = ip - 1;
    st.callStack = callStack;

    // ── instruction label (read-only peek) ──
    switch (op) {
      case Op.PUSH_INT: st._currentInstruction = `PUSH_INT ${st.bytecode[ip]}`; break;
      case Op.PUSH_STR: st._currentInstruction = `PUSH_STR "${st.constants[st.bytecode[ip]]}"`; break;
      case Op.JUMP: st._currentInstruction = `JUMP ${st.bytecode[ip]}`; break;
      case Op.PUSH_BLOCK: st._currentInstruction = `PUSH_BLOCK ${st.bytecode[ip]}`; break;
      case Op.CALL_CUSTOM: st._currentInstruction = `CALL_CUSTOM ${st.bytecode[ip]}`; break;
      case Op.MAKE_ARRAY: st._currentInstruction = `MAKE_ARRAY ${st.bytecode[ip]}`; break;
      case Op.EACH: st._currentInstruction = 'EACH'; break;
      case Op.MAP: st._currentInstruction = 'MAP'; break;
      case Op.FILTER: st._currentInstruction = 'FILTER'; break;
      default: st._currentInstruction = OpReverseMap[op] || `Unknown Op::${op}`; break;
    }

    // ── execute ──
    switch (op) {
      case Op.PUSH_INT: st.stack.push(st.bytecode[ip++]); return step;
      case Op.PUSH_STR: st.stack.push(st.constants[st.bytecode[ip++]]); return step;
      case Op.JUMP: ip = st.bytecode[ip]; return step;
      case Op.PUSH_BLOCK: st.stack.push(st.bytecode[ip++]); return step;

      case Op.RETURN: {
        if (callStack.length === 0) return onDone();
        const frame = callStack.pop();
        if (typeof frame === 'number') {
          ip = frame;
          return step;
        } else {
          // It's an iteration frame (EACH, MAP, FILTER)
          // The onDone callback for this makeRunCont call handles the "after-block" logic
          return onDone();
        }
      }
      case Op.CALL_CUSTOM: {
        if (callStack.length >= st.maxCallStack) throw new Error("Call stack overflow");
        const tgt = st.bytecode[ip++];
        callStack.push(ip);
        ip = tgt;
        return step;
      }
      case Op.MAKE_ARRAY: {
        const len = st.bytecode[ip++];
        const arr = len > 0 ? st.stack.splice(-len) : [];
        st.stack.push(arr);
        return step;
      }

      case Op.DUP: {
        if (st.stack.length < 1) throw new Error("Stack underflow");
        st.stack.push(st.stack[st.stack.length - 1]);
        return step;
      }
      case Op.DROP: st.stack.pop(); return step;
      case Op.SWAP: {
        const y = st.stack.pop(); const x = st.stack.pop();
        st.stack.push(y, x); return step;
      }
      case Op.OVER: {
        const y = st.stack.pop(); const x = st.stack.pop();
        st.stack.push(x, y, x); return step;
      }
      case Op.ROT: {
        const z = st.stack.pop(); const y = st.stack.pop(); const x = st.stack.pop();
        st.stack.push(y, z, x); return step;
      }
      case Op.T: st.stack.push(st.stack[st.stack.length - 1]); return step;

      case Op.HOST: st.stack.push(new URL(st.stack.pop()).hostname); return step;
      case Op.PATH: st.stack.push(new URL(st.stack.pop()).pathname); return step;
      case Op.PROTO: st.stack.push(new URL(st.stack.pop()).protocol.replace(":", "")); return step;
      case Op.PORT: st.stack.push(new URL(st.stack.pop()).port || ""); return step;
      case Op.HASH: st.stack.push(new URL(st.stack.pop()).hash.replace("#", "")); return step;
      case Op.PARAM: {
        const key = st.stack.pop();
        st.stack.push(new URL(st.stack.pop()).searchParams.get(key) || "");
        return step;
      }
      case Op.HAS_PARAM: {
        const key = st.stack.pop();
        st.stack.push(new URL(st.stack.pop()).searchParams.has(key) ? 1 : 0);
        return step;
      }
      case Op.SEGMENT: {
        const idx = st.stack.pop();
        const segs = new URL(st.stack.pop()).pathname.split('/').filter(s => s.length > 0);
        st.stack.push(segs[idx] || "");
        return step;
      }

      case Op.EQ: { const b = st.stack.pop(); st.stack.push(st.stack.pop() === b ? 1 : 0); return step; }
      case Op.NEQ: { const b = st.stack.pop(); st.stack.push(st.stack.pop() !== b ? 1 : 0); return step; }
      case Op.STARTS_WITH: { const pfx = st.stack.pop(); st.stack.push(String(st.stack.pop()).startsWith(String(pfx)) ? 1 : 0); return step; }
      case Op.ENDS_WITH: { const sfx = st.stack.pop(); st.stack.push(String(st.stack.pop()).endsWith(String(sfx)) ? 1 : 0); return step; }
      case Op.CONTAINS: { const sub = st.stack.pop(); st.stack.push(String(st.stack.pop()).includes(String(sub)) ? 1 : 0); return step; }
      case Op.AND: { const b = st.stack.pop(); const a = st.stack.pop(); st.stack.push((a && b) ? 1 : 0); return step; }
      case Op.OR: { const b = st.stack.pop(); const a = st.stack.pop(); st.stack.push((a || b) ? 1 : 0); return step; }
      case Op.NOT: { st.stack.push(!st.stack.pop() ? 1 : 0); return step; }
      case Op.STR_Q: { const v = st.stack[st.stack.length - 1]; st.stack.push(typeof v === 'string' ? 1 : 0); return step; }
      case Op.INT_Q: { const v = st.stack[st.stack.length - 1]; st.stack.push(typeof v === 'number' ? 1 : 0); return step; }
      case Op.ARR_Q: { const v = st.stack[st.stack.length - 1]; st.stack.push(Array.isArray(v) ? 1 : 0); return step; }
      case Op.QUOT_Q: { const v = st.stack[st.stack.length - 1]; st.stack.push((v !== null && typeof v === 'object' && v.type === 'QUOTATION') || typeof v === 'number' ? 1 : 0); return step; }

      case Op.CONCAT: { const b = st.stack.pop(); st.stack.push(String(st.stack.pop()) + String(b)); return step; }
      case Op.REPLACE: { const rep = st.stack.pop(); const srch = st.stack.pop(); st.stack.push(String(st.stack.pop()).replace(String(srch), String(rep))); return step; }
      case Op.REPLACE_ALL: { const rep = st.stack.pop(); const srch = st.stack.pop(); st.stack.push(String(st.stack.pop()).split(String(srch)).join(String(rep))); return step; }
      case Op.SUBSTR: { const len = st.stack.pop(); const idx = st.stack.pop(); st.stack.push(String(st.stack.pop()).substr(idx, len)); return step; }

      case Op.SET_PARAM: {
        const val = st.stack.pop(); const key = st.stack.pop();
        let u = new URL(st.stack.pop()); u.searchParams.set(key, val);
        st.stack.push(u.toString()); return step;
      }
      case Op.REMOVE_PARAM: {
        const key = st.stack.pop(); let u = new URL(st.stack.pop());
        u.searchParams.delete(key); st.stack.push(u.toString()); return step;
      }

      case Op.SPLIT: { const delim = st.stack.pop(); st.stack.push(String(st.stack.pop()).split(String(delim))); return step; }
      case Op.PARAM_KEYS: { st.stack.push(Array.from(new URL(st.stack.pop()).searchParams.keys())); return step; }
      case Op.PARAM_VALUES: { st.stack.push(Array.from(new URL(st.stack.pop()).searchParams.values())); return step; }
      case Op.PATH_SEGMENTS: { st.stack.push(new URL(st.stack.pop()).pathname.split('/').filter(x => x.length > 0)); return step; }
      case Op.LEN: { const arr = st.stack.pop(); st.stack.push(Array.isArray(arr) ? arr.length : 0); return step; }
      case Op.GET: { const i = st.stack.pop(); const arr = st.stack.pop(); st.stack.push(Array.isArray(arr) ? arr[i] : null); return step; }
      case Op.JOIN: { const d = st.stack.pop(); const arr = st.stack.pop(); st.stack.push(Array.isArray(arr) ? arr.join(d) : String(arr)); return step; }
      case Op.INDICES: { const arr = st.stack.pop(); st.stack.push(Array.isArray(arr) ? arr.map((_, idx) => idx) : []); return step; }
      case Op.SLICE: { const num = st.stack.pop(); const start = st.stack.pop(); const arr = st.stack.pop(); st.stack.push(Array.isArray(arr) ? arr.slice(start, start + num) : []); return step; }
      case Op.ZIP: {
        const b = st.stack.pop(), a = st.stack.pop();
        if (!Array.isArray(a) || !Array.isArray(b)) { st.stack.push([]); return step; }
        const len = Math.min(a.length, b.length);
        st.stack.push(Array.from({ length: len }, (_, i) => [a[i], b[i]]));
        return step;
      }

      case Op.CALL: {
        if (callStack.length >= st.maxCallStack) throw new Error("Call stack overflow");
        const pushIp = st.stack.pop();
        callStack.push(ip);
        ip = pushIp;
        return step;
      }
      case Op.CALL_IF: {
        const pushIp = st.stack.pop();
        const flag = st.stack.pop();
        if (flag) {
          if (callStack.length >= st.maxCallStack) throw new Error("Call stack overflow");
          callStack.push(ip);
          ip = pushIp;
        }
        return step;
      }
      case Op.CHOOSE: {
        const fIp = st.stack.pop();
        const tIp = st.stack.pop();
        const flag = st.stack.pop();
        if (callStack.length >= st.maxCallStack) throw new Error("Call stack overflow");
        callStack.push(ip);
        ip = flag ? tIp : fIp;
        return step;
      }

      /* ── higher-order: each iteration spawns a nested run frame ── */

      case Op.EACH: {
        const blockIp = st.stack.pop();
        const arr = st.stack.pop();
        if (!Array.isArray(arr) || arr.length === 0) return step;
        if (callStack.length >= st.maxCallStack) throw new Error("Call stack overflow");
        let index = 0;
        function nextItem() {
          if (index >= arr.length) return step;
          st.stack.push(arr[index]);
          index++;
          // We need an iteration frame for RETURN to know where to go back
          callStack.push({ type: 'EACH', returnIp: ip });
          // Note: EACH doesn't collect values, just continues
          return makeRunCont(st, blockIp, () => nextItem());
        }
        return nextItem();
      }
      case Op.MAP: {
        const blockIp = st.stack.pop();
        const arr = st.stack.pop();
        if (!Array.isArray(arr) || arr.length === 0) {
          st.stack.push([]);
          return step;
        }
        if (callStack.length >= st.maxCallStack) throw new Error("Call stack overflow");
        const results = [];
        let index = 0;
        function nextItem() {
          if (index >= arr.length) {
            st.stack.push(results);
            return step;
          }
          st.stack.push(arr[index]);
          index++;
          callStack.push({ type: 'MAP', returnIp: ip });
          return makeRunCont(st, blockIp, function afterBlock() {
            results.push(st.stack.pop());
            return nextItem();
          });
        }
        return nextItem();
      }
      case Op.FILTER: {
        const blockIp = st.stack.pop();
        const arr = st.stack.pop();
        if (!Array.isArray(arr) || arr.length === 0) {
          st.stack.push([]);
          return step;
        }
        if (callStack.length >= st.maxCallStack) throw new Error("Call stack overflow");
        const results = [];
        let index = 0;
        function nextItem() {
          if (index >= arr.length) {
            st.stack.push(results);
            return step;
          }
          const item = arr[index];
          st.stack.push(item);
          index++;
          callStack.push({ type: 'FILTER', returnIp: ip });
          return makeRunCont(st, blockIp, function afterBlock() {
            if (st.stack.pop()) results.push(item);
            return nextItem();
          });
        }
        return nextItem();
      }

      case Op.REDIRECT: {
        st.redirectUrl = st.stack.pop();
        return null;
      }
      case Op.SKIP: return null;

      default: throw new Error(`Unknown opcode: ${op}`);
    }
  }

  return step;
}
