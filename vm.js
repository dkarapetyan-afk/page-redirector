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
      let ip = 0;
      while (ip < bytecode.length || callStack.length > 0) {
        if (ip >= bytecode.length) {
          if (callStack.length === 0) break;
          const st = { ip, stack, callStack };
          this._handleReturn(st);
          ip = st.ip;
          continue;
        }

        if (ops++ > maxOps) throw new Error("Maximum operations exceeded");
        const op = bytecode[ip++];

        switch (op) {
          case Op.PUSH_INT: stack.push(bytecode[ip] | (bytecode[ip + 1] << 8)); ip += 2; break;
          case Op.PUSH_STR: stack.push(constants[bytecode[ip] | (bytecode[ip + 1] << 8)]); ip += 2; break;
          case Op.JUMP: ip = bytecode[ip] | (bytecode[ip + 1] << 8); break;
          case Op.PUSH_BLOCK: stack.push(bytecode[ip] | (bytecode[ip + 1] << 8)); ip += 2; break;
          case Op.RETURN: {
            if (callStack.length === 0) return { success: true, redirect: redirectUrl, stack, ops };
            const st = { ip, stack, callStack };
            this._handleReturn(st);
            ip = st.ip;
            break;
          }
          case Op.CALL_CUSTOM: {
            if (callStack.length >= maxCallStack) throw new Error("Call stack overflow");
            const tgt = bytecode[ip] | (bytecode[ip + 1] << 8);
            ip += 2;
            callStack.push(ip);
            ip = tgt;
            break;
          }
          case Op.MAKE_ARRAY: {
            const len = bytecode[ip] | (bytecode[ip + 1] << 8);
            ip += 2;
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
            return { success: true, redirect: redirectUrl, stack, ops };
          }
          case Op.SKIP: return { success: true, redirect: redirectUrl, stack, ops };
          default: throw new Error(`Unknown opcode: ${op}`);
        }
        if (redirectUrl) return { success: true, redirect: redirectUrl, stack, ops };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
    return { success: true, redirect: redirectUrl, stack, ops };
  }

  static _handleReturn(st) {
    const frame = st.callStack.pop();
    if (typeof frame === 'number') {
      st.ip = frame;
    } else {
      // Higher-order word iteration
      let res;
      if (frame.type === 'MAP' || frame.type === 'FILTER') {
        res = st.stack.pop();
      }
      if (frame.type === 'FILTER') {
        if (res) frame.results.push(frame.arr[frame.index]);
      } else if (frame.type === 'MAP') {
        frame.results.push(res);
      }
      frame.index++;
      if (frame.index < frame.arr.length) {
        st.callStack.push(frame); // Keep iterating
        st.stack.push(frame.arr[frame.index]);
        st.ip = frame.blockIp;
      } else {
        // Iteration finished
        if (frame.type === 'MAP' || frame.type === 'FILTER') {
          st.stack.push(frame.results);
        }
        st.ip = frame.returnIp;
      }
    }
  }

  static createDebugSession(bytecode, constants, initialUrl, options = {}) {
    const st = {
      ip: 0,
      bytecode,
      constants,
      stack: [initialUrl],
      callStack: [],
      redirectUrl: null,
      ops: 0,
      error: null,
      maxCallStack: options.maxCallStack || 16,
      _currentInstruction: "",
      _gen: null
    };
    st._gen = this.debugGenerator(st);
    return { state: st, done: false };
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

  static *debugGenerator(st) {
    const { bytecode, constants, stack, callStack } = st;
    const maxOps = 10000;

    while (st.ip < bytecode.length || callStack.length > 0) {
      if (st.ip >= bytecode.length) {
        if (callStack.length === 0) break;
        this._handleReturn(st);
        yield st;
        continue;
      }

      const op = bytecode[st.ip]; // Peek
      
      // Update instruction label for UI
      switch (op) {
        case Op.PUSH_INT:   st._currentInstruction = `PUSH_INT ${bytecode[st.ip+1]}`;    break;
        case Op.PUSH_STR:   st._currentInstruction = `PUSH_STR "${constants[bytecode[st.ip+1]]}"`; break;
        case Op.JUMP:       st._currentInstruction = `JUMP ${bytecode[st.ip+1]}`;        break;
        case Op.PUSH_BLOCK: st._currentInstruction = `PUSH_BLOCK ${bytecode[st.ip+1]}`;  break;
        case Op.CALL_CUSTOM:st._currentInstruction = `CALL_CUSTOM ${bytecode[st.ip+1]}`; break;
        case Op.MAKE_ARRAY: st._currentInstruction = `MAKE_ARRAY ${bytecode[st.ip+1]}`;  break;
        case Op.EACH:       st._currentInstruction = 'EACH';   break;
        case Op.MAP:        st._currentInstruction = 'MAP';    break;
        case Op.FILTER:     st._currentInstruction = 'FILTER'; break;
        default: st._currentInstruction = OpReverseMap[op] || `Unknown Op::${op}`; break;
      }

      yield st; // Yield BEFORE execution so the UI shows the instruction we ARE ON

      if (st.ops++ > maxOps) throw new Error("Maximum operations exceeded");
      st.ip++; // Consume op now

      switch (op) {
        case Op.PUSH_INT: stack.push(bytecode[st.ip++]); break;
        case Op.PUSH_STR: stack.push(constants[bytecode[st.ip++]]); break;
        case Op.JUMP:     st.ip = bytecode[st.ip]; break;
        case Op.PUSH_BLOCK: stack.push(bytecode[st.ip++]); break;
        case Op.RETURN: {
          if (callStack.length === 0) return;
          this._handleReturn(st);
          break;
        }
        case Op.CALL_CUSTOM: {
          if (callStack.length >= st.maxCallStack) throw new Error("Call stack overflow");
          const tgt = bytecode[st.ip++];
          callStack.push(st.ip);
          st.ip = tgt;
          break;
        }
        case Op.MAKE_ARRAY: {
          const len = bytecode[st.ip++];
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
          if (callStack.length >= st.maxCallStack) throw new Error("Call stack overflow");
          const pushIp = stack.pop();
          callStack.push(st.ip);
          st.ip = pushIp;
          break;
        }
        case Op.CALL_IF: {
          const pushIp = stack.pop(), flag = stack.pop();
          if (flag) {
            if (callStack.length >= st.maxCallStack) throw new Error("Call stack overflow");
            callStack.push(st.ip);
            st.ip = pushIp;
          }
          break;
        }
        case Op.CHOOSE: {
          const fIp = stack.pop(), tIp = stack.pop(), flag = stack.pop();
          if (callStack.length >= st.maxCallStack) throw new Error("Call stack overflow");
          callStack.push(st.ip);
          st.ip = flag ? tIp : fIp;
          break;
        }
        case Op.EACH: {
          const blockIp = stack.pop(), arr = stack.pop();
          if (!Array.isArray(arr) || arr.length === 0) break;
          if (callStack.length >= st.maxCallStack) throw new Error("Call stack overflow");
          callStack.push({ type: 'EACH', blockIp, returnIp: st.ip, arr, index: 0 });
          stack.push(arr[0]);
          st.ip = blockIp;
          break;
        }
        case Op.MAP: {
          const blockIp = stack.pop(), arr = stack.pop();
          if (!Array.isArray(arr) || arr.length === 0) { stack.push([]); break; }
          if (callStack.length >= st.maxCallStack) throw new Error("Call stack overflow");
          callStack.push({ type: 'MAP', blockIp, returnIp: st.ip, arr, index: 0, results: [] });
          stack.push(arr[0]);
          st.ip = blockIp;
          break;
        }
        case Op.FILTER: {
          const blockIp = stack.pop(), arr = stack.pop();
          if (!Array.isArray(arr) || arr.length === 0) { stack.push([]); break; }
          if (callStack.length >= st.maxCallStack) throw new Error("Call stack overflow");
          callStack.push({ type: 'FILTER', blockIp, returnIp: st.ip, arr, index: 0, results: [] });
          stack.push(arr[0]);
          st.ip = blockIp;
          break;
        }
        case Op.REDIRECT: {
          st.redirectUrl = stack.pop();
          return;
        }
        case Op.SKIP: return;
        default: throw new Error(`Unknown opcode: ${op}`);
      }
      if (st.redirectUrl) return;
    }
  }
}
