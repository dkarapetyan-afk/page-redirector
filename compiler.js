import { Interpreter } from './interpreter.js';
import { Op, BuiltinMap } from './opcodes.js';

export const COMPILER_VERSION = 1;

export class Compiler {
  static compile(source) {
    const interpreter = new Interpreter();
    const lexRes = interpreter.tokenize(source);
    if (!lexRes.success) {
      throw new Error(lexRes.error);
    }
    const tokens = lexRes.tokens;
    const bytecode = [];
    const constants = [];
    const definitions = {};
    const mainTokens = [];
    let i = 0;
    while (i < tokens.length) {
      if (tokens[i].type === ':') {
        if (i + 1 >= tokens.length || tokens[i + 1].type !== 'WORD') {
          throw new Error("Expected word name after ':'");
        }
        const name = tokens[i + 1].value;
        if (BuiltinMap[name]) {
          throw new Error(`Compile Error: Word definition for '${name}' overrides a built-in word.`);
        }
        i += 2;
        let start = i;
        let depth = 0;
        while (i < tokens.length) {
          if (tokens[i].type === ':') depth++;
          if (tokens[i].type === ';') {
            if (depth === 0) break;
            depth--;
          }
          i++;
        }
        if (i >= tokens.length) {
          throw new Error(`Unterminated definition for word '${name}'`);
        }
        definitions[name] = tokens.slice(start, i);
        i++; // skip semicolon
      } else {
        mainTokens.push(tokens[i]);
        i++;
      }
    }
    function emit(op, arg) {
      bytecode.push(op);
      if (arg !== undefined) {
        bytecode.push(arg);
      }
      return bytecode.length - 1;
    }
    const patchList = [];
    const customWordIps = {};
    function compilePass(ts, isBlock) {
      let j = 0;
      let pushedTokens = 0;
      while (j < ts.length) {
        const t = ts[j];
        if (t.type === 'NUMBER') {
          emit(Op.PUSH_INT, t.value);
          pushedTokens++;
        } else if (t.type === 'STRING') {
          let cidx = constants.indexOf(t.value);
          if (cidx === -1) {
            cidx = constants.length;
            constants.push(t.value);
          }
          emit(Op.PUSH_STR, cidx);
          pushedTokens++;
        } else if (t.type === 'WORD') {
          const name = t.value;
          if (BuiltinMap[name]) {
            emit(BuiltinMap[name]);
          } else if (definitions[name]) {
            emit(Op.CALL_CUSTOM, 0);
            patchList.push({ idx: bytecode.length - 1, name: name });
          } else {
            throw new Error(`Unknown word during compilation: ${name}`);
          }
        } else if (t.type === '[') {
          let depth = 0;
          j++;
          let start = j;
          while (j < ts.length) {
            if (ts[j].type === '[') depth++;
            if (ts[j].type === ']') {
              if (depth === 0) break;
              depth--;
            }
            j++;
          }
          const blockTokens = ts.slice(start, j);
          // Block compilation strategy:
          // We need to push the address of the block body onto the stack, but skip
          // over that body during normal linear execution.
          // Bytecode layout: [PUSH_BLOCK] [body_addr] [JUMP] [next_addr] [body...] [RETURN]
          // Example: [ "foo" redirect ] -> PUSH_BLOCK 10, JUMP 15, PUSH_STR "foo", REDIRECT, RETURN, <next>
          emit(Op.PUSH_BLOCK, 0);
          const pushArgIdx = bytecode.length - 1;
          emit(Op.JUMP, 0);
          const jumpArgIdx = bytecode.length - 1;
          bytecode[pushArgIdx] = bytecode.length; // Body starts here
          compilePass(blockTokens, true);         // Compile body + Op.RETURN
          bytecode[jumpArgIdx] = bytecode.length; // Jump skips to here
          pushedTokens++;
        } else if (t.type === '{') {
          let depth = 0;
          j++;
          let start = j;
          while (j < ts.length) {
            if (ts[j].type === '{') depth++;
            if (ts[j].type === '}') {
              if (depth === 0) break;
              depth--;
            }
            j++;
          }
          const arrayTokens = ts.slice(start, j);
          const innerCount = compilePass(arrayTokens, false);
          emit(Op.MAKE_ARRAY, innerCount);
          pushedTokens++;
        } else if (t.type === ']' || t.type === '}' || t.type === ';') {
          // skip silently, bounds handled above
        }
        j++;
      }
      if (isBlock) {
        emit(Op.RETURN);
      }
      return pushedTokens;
    }
    compilePass(mainTokens, false);
    emit(Op.JUMP, 0);
    const endJumpIdx = bytecode.length - 1;
    for (const [name, defTokens] of Object.entries(definitions)) {
      customWordIps[name] = bytecode.length;
      compilePass(defTokens, true);
    }
    bytecode[endJumpIdx] = bytecode.length;
    for (const patch of patchList) {
      if (customWordIps[patch.name] !== undefined) {
        bytecode[patch.idx] = customWordIps[patch.name];
      } else {
        throw new Error(`Compiler internal linking error for: ${patch.name}`);
      }
    }
    return { bytecode, constants };
  }
}
