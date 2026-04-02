import { Op, OpReverseMap } from './opcodes.js';

export class VM {
    static execute(bytecode, constants, initialUrl) {
        const stack = [initialUrl];
        let redirectUrl = null;
        let ops = 0;
        const MAX_OPS = 10000;

        try {
            run(0);
        } catch (e) {
            return { success: false, error: e.message };
        }

        return { success: true, redirect: redirectUrl, stack, ops };

        function run(startIp) {
            let ip = startIp;
            const callStack = [];

            while (ip < bytecode.length) {
                if (ops++ > MAX_OPS) throw new Error("Maximum operations exceeded");
                
                const op = bytecode[ip++];
                
                switch (op) {
                    case Op.PUSH_INT:
                        stack.push(bytecode[ip++]);
                        break;
                    case Op.PUSH_STR:
                        stack.push(constants[bytecode[ip++]]);
                        break;
                    case Op.JUMP:
                        ip = bytecode[ip++];
                        break;
                    case Op.PUSH_BLOCK:
                        stack.push(bytecode[ip++]); 
                        break;
                    case Op.RETURN:
                        if (callStack.length === 0) return; // Return to host JS
                        ip = callStack.pop();
                        break;
                    case Op.CALL_CUSTOM:
                        const tgt = bytecode[ip++];
                        callStack.push(ip);
                        ip = tgt;
                        break;
                    case Op.MAKE_ARRAY: {
                        const len = bytecode[ip++];
                        const arr = [];
                        for(let i = 0; i < len; i++) {
                            arr.unshift(stack.pop());
                        }
                        stack.push(arr);
                        break;
                    }
                        
                    case Op.DUP:
                        if (stack.length < 1) throw new Error("Stack underflow");
                        stack.push(stack[stack.length - 1]);
                        break;
                    case Op.DROP:
                        stack.pop();
                        break;
                    case Op.SWAP: {
                        const y = stack.pop();
                        const x = stack.pop();
                        stack.push(y, x);
                        break;
                    }
                    case Op.OVER: {
                        const y = stack.pop();
                        const x = stack.pop();
                        stack.push(x, y, x);
                        break;
                    }
                    case Op.ROT: {
                        const z = stack.pop();
                        const y = stack.pop();
                        const x = stack.pop();
                        stack.push(y, z, x);
                        break;
                    }
                    case Op.T:
                        stack.push(stack[stack.length - 1]);
                        break;
                        
                    case Op.HOST: {
                        stack.push(new URL(stack.pop()).hostname);
                        break;
                    }
                    case Op.PATH: {
                        stack.push(new URL(stack.pop()).pathname);
                        break;
                    }
                    case Op.PROTO: {
                        stack.push(new URL(stack.pop()).protocol.replace(":", ""));
                        break;
                    }
                    case Op.PORT: {
                        stack.push(new URL(stack.pop()).port || "");
                        break;
                    }
                    case Op.HASH: {
                        stack.push(new URL(stack.pop()).hash.replace("#", ""));
                        break;
                    }
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
                        const b = stack.pop();
                        const a = stack.pop();
                        stack.push((a && b) ? 1 : 0);
                        break;
                    }
                    case Op.OR: {
                        const b = stack.pop();
                        const a = stack.pop();
                        stack.push((a || b) ? 1 : 0);
                        break;
                    }
                    case Op.NOT: {
                        stack.push(!stack.pop() ? 1 : 0);
                        break;
                    }
                    
                    case Op.CONCAT: {
                        const b = stack.pop();
                        stack.push(String(stack.pop()) + String(b));
                        break;
                    }
                    case Op.REPLACE: {
                        const rep = stack.pop();
                        const srch = stack.pop();
                        stack.push(String(stack.pop()).replace(String(srch), String(rep)));
                        break;
                    }
                    case Op.REPLACE_ALL: {
                        const rep = stack.pop();
                        const srch = stack.pop();
                        stack.push(String(stack.pop()).split(String(srch)).join(String(rep)));
                        break;
                    }
                    case Op.SUBSTR: {
                        const len = stack.pop();
                        const idx = stack.pop();
                        stack.push(String(stack.pop()).substr(idx, len));
                        break;
                    }
                    
                    case Op.SET_PARAM: {
                        const val = stack.pop();
                        const key = stack.pop();
                        let u = new URL(stack.pop());
                        u.searchParams.set(key, val);
                        stack.push(u.toString());
                        break;
                    }
                    case Op.REMOVE_PARAM: {
                        const key = stack.pop();
                        let u = new URL(stack.pop());
                        u.searchParams.delete(key);
                        stack.push(u.toString());
                        break;
                    }
                    
                    case Op.SPLIT: {
                        const delim = stack.pop();
                        stack.push(String(stack.pop()).split(String(delim)));
                        break;
                    }
                    case Op.PARAM_KEYS: {
                        stack.push(Array.from(new URL(stack.pop()).searchParams.keys()));
                        break;
                    }
                    case Op.PARAM_VALUES: {
                        stack.push(Array.from(new URL(stack.pop()).searchParams.values()));
                        break;
                    }
                    case Op.PATH_SEGMENTS: {
                        stack.push(new URL(stack.pop()).pathname.split('/').filter(x => x.length > 0));
                        break;
                    }
                    case Op.LEN: {
                        const arr = stack.pop();
                        stack.push(Array.isArray(arr) ? arr.length : 0);
                        break;
                    }
                    case Op.GET: {
                        const i = stack.pop();
                        const arr = stack.pop();
                        stack.push(Array.isArray(arr) ? arr[i] : null);
                        break;
                    }
                    case Op.JOIN: {
                        const d = stack.pop();
                        const arr = stack.pop();
                        stack.push(Array.isArray(arr) ? arr.join(d) : String(arr));
                        break;
                    }
                    case Op.INDICES: {
                        const arr = stack.pop();
                        stack.push(Array.isArray(arr) ? arr.map((_, idx) => idx) : []);
                        break;
                    }
                    case Op.SLICE: {
                        const num = stack.pop();
                        const start = stack.pop();
                        const arr = stack.pop();
                        stack.push(Array.isArray(arr) ? arr.slice(start, start + num) : []);
                        break;
                    }
                    
                    case Op.CALL: {
                        const pushIp = stack.pop();
                        callStack.push(ip);
                        ip = pushIp;
                        break;
                    }
                    case Op.CALL_IF: {
                        const pushIp = stack.pop();
                        const flag = stack.pop();
                        if (flag) {
                            callStack.push(ip);
                            ip = pushIp;
                        }
                        break;
                    }
                    case Op.CHOOSE: {
                        const fIp = stack.pop();
                        const tIp = stack.pop();
                        const flag = stack.pop();
                        callStack.push(ip);
                        ip = flag ? tIp : fIp;
                        break;
                    }
                    
                    case Op.EACH: {
                        const eachIp = stack.pop();
                        const eachArr = stack.pop();
                        if (Array.isArray(eachArr)) {
                            for(let item of eachArr) {
                                stack.push(item);
                                run(eachIp);
                                if (redirectUrl) return; 
                            }
                        }
                        break;
                    }
                    case Op.MAP: {
                        const eachIp = stack.pop();
                        const eachArr = stack.pop();
                        if (Array.isArray(eachArr)) {
                            const narr = [];
                            for(let item of eachArr) {
                                stack.push(item);
                                run(eachIp);
                                if (redirectUrl) return;
                                narr.push(stack.pop());
                            }
                            stack.push(narr);
                        } else stack.push([]);
                        break;
                    }
                    case Op.FILTER: {
                        const eachIp = stack.pop();
                        const eachArr = stack.pop();
                        if (Array.isArray(eachArr)) {
                            const narr = [];
                            for(let item of eachArr) {
                                stack.push(item);
                                run(eachIp);
                                if (redirectUrl) return;
                                const flag = stack.pop();
                                if (flag) narr.push(item);
                            }
                            stack.push(narr);
                        } else stack.push([]);
                        break;
                    }
                    
                    case Op.REDIRECT: {
                        redirectUrl = stack.pop();
                        return;
                    }
                    case Op.SKIP: {
                        return;
                    }
                        
                    default:
                        throw new Error(`Unknown opcode: ${op}`);
                }
            }
        }
    }

    static createDebugSession(bytecode, constants, initialUrl) {
        return {
            state: {
                ip: 0,
                bytecode,
                constants,
                stack: [initialUrl],
                callStack: [],
                redirectUrl: null,
                ops: 0,
                error: null,
                _currentInstruction: ""
            },
            done: false
        };
    }

    static stepSession(session) {
        if (session.done) return session;
        const st = session.state;

        if (st.ip >= st.bytecode.length || st.redirectUrl !== null || st.error) {
            session.done = true;
            return session;
        }

        if (st.ops >= 10000) {
            st.error = "Maximum operations exceeded";
            session.done = true;
            return session;
        }

        const op = st.bytecode[st.ip++];
        
        switch (op) {
            case Op.PUSH_INT: st._currentInstruction = `PUSH_INT ${st.bytecode[st.ip]}`; break;
            case Op.PUSH_STR: st._currentInstruction = `PUSH_STR "${st.constants[st.bytecode[st.ip]]}"`; break;
            case Op.JUMP: st._currentInstruction = `JUMP ${st.bytecode[st.ip]}`; break;
            case Op.PUSH_BLOCK: st._currentInstruction = `PUSH_BLOCK ${st.bytecode[st.ip]}`; break;
            case Op.CALL_CUSTOM: st._currentInstruction = `CALL_CUSTOM ${st.bytecode[st.ip]}`; break;
            case Op.MAKE_ARRAY: st._currentInstruction = `MAKE_ARRAY ${st.bytecode[st.ip]}`; break;
            default: st._currentInstruction = OpReverseMap[op] || `Unknown Op::${op}`; break;
        }

        try {
            st.ops++;
            
            switch (op) {
                case Op.PUSH_INT:   st.stack.push(st.bytecode[st.ip++]); break;
                case Op.PUSH_STR:   st.stack.push(st.constants[st.bytecode[st.ip++]]); break;
                case Op.JUMP:       st.ip = st.bytecode[st.ip++]; break;
                case Op.PUSH_BLOCK: st.stack.push(st.bytecode[st.ip++]); break;
                case Op.RETURN:
                    if (st.callStack.length === 0) { session.done = true; break; }
                    st.ip = st.callStack.pop();
                    break;
                case Op.CALL_CUSTOM:
                    const tgt = st.bytecode[st.ip++];
                    st.callStack.push(st.ip);
                    st.ip = tgt;
                    break;
                case Op.MAKE_ARRAY: {
                    const len = st.bytecode[st.ip++];
                    const arr = [];
                    for (let i = 0; i < len; i++) {
                        arr.unshift(st.stack.pop());
                    }
                    st.stack.push(arr);
                    break;
                }
                case Op.DUP:
                    if (st.stack.length < 1) throw new Error("Stack underflow");
                    st.stack.push(st.stack[st.stack.length - 1]);
                    break;
                case Op.DROP: st.stack.pop(); break;
                case Op.SWAP: {
                    const y = st.stack.pop(); const x = st.stack.pop();
                    st.stack.push(y, x); break;
                }
                case Op.OVER: {
                    const y = st.stack.pop(); const x = st.stack.pop();
                    st.stack.push(x, y, x); break;
                }
                case Op.ROT: {
                    const z = st.stack.pop(); const y = st.stack.pop(); const x = st.stack.pop();
                    st.stack.push(y, z, x); break;
                }
                case Op.T: st.stack.push(st.stack[st.stack.length - 1]); break;
                
                case Op.HOST: st.stack.push(new URL(st.stack.pop()).hostname); break;
                case Op.PATH: st.stack.push(new URL(st.stack.pop()).pathname); break;
                case Op.PROTO: st.stack.push(new URL(st.stack.pop()).protocol.replace(":", "")); break;
                case Op.PORT: st.stack.push(new URL(st.stack.pop()).port || ""); break;
                case Op.HASH: st.stack.push(new URL(st.stack.pop()).hash.replace("#", "")); break;
                case Op.PARAM: {
                    const key = st.stack.pop();
                    st.stack.push(new URL(st.stack.pop()).searchParams.get(key) || ""); break;
                }
                case Op.HAS_PARAM: {
                    const key = st.stack.pop();
                    st.stack.push(new URL(st.stack.pop()).searchParams.has(key) ? 1 : 0); break;
                }
                case Op.SEGMENT: {
                    const idx = st.stack.pop();
                    const segs = new URL(st.stack.pop()).pathname.split('/').filter(s => s.length > 0);
                    st.stack.push(segs[idx] || ""); break;
                }
                
                case Op.EQ: { const b = st.stack.pop(); st.stack.push(st.stack.pop() === b ? 1 : 0); break; }
                case Op.NEQ: { const b = st.stack.pop(); st.stack.push(st.stack.pop() !== b ? 1 : 0); break; }
                case Op.STARTS_WITH: { const pfx = st.stack.pop(); st.stack.push(String(st.stack.pop()).startsWith(String(pfx)) ? 1 : 0); break; }
                case Op.ENDS_WITH: { const sfx = st.stack.pop(); st.stack.push(String(st.stack.pop()).endsWith(String(sfx)) ? 1 : 0); break; }
                case Op.CONTAINS: { const sub = st.stack.pop(); st.stack.push(String(st.stack.pop()).includes(String(sub)) ? 1 : 0); break; }
                case Op.AND: { const b = st.stack.pop(); const a = st.stack.pop(); st.stack.push((a && b) ? 1 : 0); break; }
                case Op.OR: { const b = st.stack.pop(); const a = st.stack.pop(); st.stack.push((a || b) ? 1 : 0); break; }
                case Op.NOT: { st.stack.push(!st.stack.pop() ? 1 : 0); break; }
                
                case Op.CONCAT: { const b = st.stack.pop(); st.stack.push(String(st.stack.pop()) + String(b)); break; }
                case Op.REPLACE: { const rep = st.stack.pop(); const srch = st.stack.pop(); st.stack.push(String(st.stack.pop()).replace(String(srch), String(rep))); break; }
                case Op.REPLACE_ALL: { const rep = st.stack.pop(); const srch = st.stack.pop(); st.stack.push(String(st.stack.pop()).split(String(srch)).join(String(rep))); break; }
                case Op.SUBSTR: { const len = st.stack.pop(); const idx = st.stack.pop(); st.stack.push(String(st.stack.pop()).substr(idx, len)); break; }
                
                case Op.SET_PARAM: {
                    const val = st.stack.pop(); const key = st.stack.pop();
                    let u = new URL(st.stack.pop()); u.searchParams.set(key, val); st.stack.push(u.toString()); break;
                }
                case Op.REMOVE_PARAM: {
                    const key = st.stack.pop(); let u = new URL(st.stack.pop()); u.searchParams.delete(key); st.stack.push(u.toString()); break;
                }
                case Op.SPLIT: { const delim = st.stack.pop(); st.stack.push(String(st.stack.pop()).split(String(delim))); break; }
                case Op.PARAM_KEYS: { st.stack.push(Array.from(new URL(st.stack.pop()).searchParams.keys())); break; }
                case Op.PARAM_VALUES: { st.stack.push(Array.from(new URL(st.stack.pop()).searchParams.values())); break; }
                case Op.PATH_SEGMENTS: { st.stack.push(new URL(st.stack.pop()).pathname.split('/').filter(x => x.length > 0)); break; }
                case Op.LEN: { const arr = st.stack.pop(); st.stack.push(Array.isArray(arr) ? arr.length : 0); break; }
                case Op.GET: { const i = st.stack.pop(); const arr = st.stack.pop(); st.stack.push(Array.isArray(arr) ? arr[i] : null); break; }
                case Op.JOIN: { const d = st.stack.pop(); const arr = st.stack.pop(); st.stack.push(Array.isArray(arr) ? arr.join(d) : String(arr)); break; }
                case Op.INDICES: { const arr = st.stack.pop(); st.stack.push(Array.isArray(arr) ? arr.map((_, idx) => idx) : []); break; }
                case Op.SLICE: { const num = st.stack.pop(); const start = st.stack.pop(); const arr = st.stack.pop(); st.stack.push(Array.isArray(arr) ? arr.slice(start, start + num) : []); break; }
                
                case Op.CALL: { const pushIp = st.stack.pop(); st.callStack.push(st.ip); st.ip = pushIp; break; }
                case Op.CALL_IF: { const pushIp = st.stack.pop(); const flag = st.stack.pop(); if (flag) { st.callStack.push(st.ip); st.ip = pushIp; } break; }
                case Op.CHOOSE: { const fIp = st.stack.pop(); const tIp = st.stack.pop(); const flag = st.stack.pop(); st.callStack.push(st.ip); st.ip = flag ? tIp : fIp; break; }
                
                case Op.EACH:
                case Op.MAP:
                case Op.FILTER:
                     throw new Error(`Higher-order function ${OpReverseMap[op]} cannot be naturally step-debugged in VM currently.`);
                     
                case Op.REDIRECT: { st.redirectUrl = st.stack.pop(); session.done = true; break; }
                case Op.SKIP: { session.done = true; break; }
                default: throw new Error(`Unknown opcode: ${op}`);
            }
        } catch(e) {
            st.error = e.message;
            session.done = true;
        }

        if (st.ip >= st.bytecode.length && st.redirectUrl === null && st.callStack.length === 0) {
            session.done = true; 
        }

        return session;
    }
}
