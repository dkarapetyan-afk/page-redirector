import { Interpreter } from './interpreter.js';
import { Compiler } from './compiler.js';
import { VM } from './vm.js';
import * as wasmNode from './rs-vm/pkg-node/rs_vm.js';

const interpreter = new Interpreter();

async function test(source, expectedStack, expectedError) {
  console.log(`\nTesting: ${source}`);
  const url = 'https://example.com/';

  // 1. Interpreter (AST)
  const astResult = interpreter.execute(source, url);
  verify("AST", astResult, expectedStack, expectedError);

  // 2. JS VM
  try {
    const { bytecode, constants } = Compiler.compile(source);
    const vmResult = VM.execute(bytecode, constants, url);
    verify("JS VM", vmResult, expectedStack, expectedError);
  } catch (err) {
    console.error(`JS VM CRASH: ${err.message}`);
  }

  // 3. WASM VM
  try {
    const { bytecode, constants } = Compiler.compile(source);
    const wasmResult = wasmNode.execute(bytecode, constants, url, {});
    verify("WASM VM", wasmResult, expectedStack, expectedError);
  } catch (err) {
    console.error(`WASM VM CRASH: ${err.message}`);
  }
}

function verify(name, result, expectedStack, expectedError) {
  if (expectedError) {
    if (!result.success && result.error && result.error.includes(expectedError)) {
      console.log(`${name} PASS - Caught expected error: ${result.error}`);
    } else {
      console.error(`${name} FAIL - Expected error "${expectedError}", but got ${result.success ? "success" : "different error: " + (result.error || "no error msg")}`);
    }
  } else {
    if (!result.success) {
      console.error(`${name} FAIL - Error: ${result.error}`);
    } else {
      const top = result.stack[result.stack.length - 1];
      if (top === expectedStack) {
        console.log(`${name} PASS - Result: ${top}`);
      } else {
        console.error(`${name} FAIL - Expected ${expectedStack}, got ${top}`);
      }
    }
  }
}

async function run() {
  // Simple Arithmetic
  await test('10 5 +', 15);
  await test('10 5 -', 5);
  await test('10 5 *', 50);
  await test('10 5 /', 2);
  await test('10 5 %', 0);

  // Negative result
  await test('5 10 -', -5);

  // 16-bit Overflow (Positive)
  // 32767 + 1 -> -32768
  await test('32767 1 +', -32768);
  
  // 16-bit Overflow (Negative)
  // -32768 1 - -> 32767
  await test('-32768 1 -', 32767);

  // Multiplication overflow
  // 1000 40 * -> 40000 -> -25536
  await test('1000 40 *', -25536);

  // Division Truncation
  await test('7 3 /', 2);
  await test('-7 3 /', -2);

  // Division by zero
  await test('10 0 /', null, "Division by zero");
  await test('10 0 %', null, "Division by zero");

  // Comparisons
  await test('10 5 >', 1);
  await test('5 10 >', 0);
  await test('10 10 >', 0);

  await test('10 5 >=', 1);
  await test('10 10 >=', 1);
  await test('5 10 >=', 0);

  await test('5 10 <', 1);
  await test('10 5 <', 0);
  await test('10 10 <', 0);

  await test('5 10 <=', 1);
  await test('10 10 <=', 1);
  await test('10 5 <=', 0);

  // Negative Comparisons
  await test('-10 -5 <', 1);
  await test('-5 -10 <', 0);
  await test('-10 -10 <', 0);
  await test('-10 -5 >', 0);
  await test('-5 -10 >', 1);
  await test('-10 -10 >', 0);
  await test('-10 5 <', 1);
  await test('5 -10 <', 0);

  // Mixed 16-bit behavior
  await test('40000', -25536);
}

run();
