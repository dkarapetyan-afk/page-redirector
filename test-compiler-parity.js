import { Compiler } from './compiler.js';
import * as wasmNode from './rs-vm/pkg-node/rs_vm.js';

// ── Bytecode Parity Tests ──────────────────────────────────────────────
// Verify that the Rust compiler produces byte-identical bytecode and
// constants arrays to the JS compiler for the same source input.

let passed = 0;
let failed = 0;

function testBytecodeParity(source) {
  const label = source.length > 60 ? source.substring(0, 57) + '...' : source;
  try {
    // JS compiler
    const jsResult = Compiler.compile(source);
    const jsBytecode = Array.from(jsResult.bytecode);
    const jsConstants = jsResult.constants;

    // Rust compiler
    const rsResult = wasmNode.compile(source);
    if (!rsResult.success) {
      console.error(`  FAIL [bytecode] ${label}`);
      console.error(`    Rust compile error: ${rsResult.error}`);
      failed++;
      return;
    }
    const rsBytecode = Array.from(rsResult.bytecode);
    const rsConstants = rsResult.constants;

    // Compare bytecode
    let bytecodeMatch = true;
    if (jsBytecode.length !== rsBytecode.length) {
      bytecodeMatch = false;
    } else {
      for (let i = 0; i < jsBytecode.length; i++) {
        if (jsBytecode[i] !== rsBytecode[i]) {
          bytecodeMatch = false;
          break;
        }
      }
    }

    // Compare constants
    let constantsMatch = true;
    if (jsConstants.length !== rsConstants.length) {
      constantsMatch = false;
    } else {
      for (let i = 0; i < jsConstants.length; i++) {
        if (jsConstants[i] !== rsConstants[i]) {
          constantsMatch = false;
          break;
        }
      }
    }

    if (bytecodeMatch && constantsMatch) {
      console.log(`  ✅ PASS [bytecode] ${label} (${jsBytecode.length} bytes, ${jsConstants.length} const)`);
      passed++;
    } else {
      console.error(`  ❌ FAIL [bytecode] ${label}`);
      if (!bytecodeMatch) {
        console.error(`    JS  bytecode (${jsBytecode.length}): [${jsBytecode.join(', ')}]`);
        console.error(`    RS  bytecode (${rsBytecode.length}): [${rsBytecode.join(', ')}]`);
      }
      if (!constantsMatch) {
        console.error(`    JS  constants: ${JSON.stringify(jsConstants)}`);
        console.error(`    RS  constants: ${JSON.stringify(rsConstants)}`);
      }
      failed++;
    }
  } catch (err) {
    console.error(`  ❌ FAIL [bytecode] ${label}: ${err.message}`);
    failed++;
  }
}

// ── compile_and_execute Parity Tests ───────────────────────────────────
// Verify that compile_and_execute produces the same execution result as
// the JS compiler → WASM execute path.

function testCompileAndExecute(source, expectedRedirect, expectedError) {
  const label = source.length > 60 ? source.substring(0, 57) + '...' : source;
  const url = 'https://example.com/foo/bar?key=val';
  try {
    // JS compile → WASM execute
    const { bytecode, constants } = Compiler.compile(source);
    const jsVmResult = wasmNode.execute(bytecode, constants, url, {});

    // Rust compile_and_execute
    const rsResult = wasmNode.compile_and_execute(source, url, {});

    // Compare
    if (expectedError) {
      if (!rsResult.success && rsResult.error && rsResult.error.includes(expectedError)) {
        console.log(`  ✅ PASS [c&e] ${label} (expected error: "${expectedError}")`);
        passed++;
      } else {
        console.error(`  ❌ FAIL [c&e] ${label}: expected error "${expectedError}", got ${rsResult.success ? 'success' : rsResult.error}`);
        failed++;
      }
      return;
    }

    const jsRedirect = jsVmResult.redirect;
    const rsRedirect = rsResult.redirect;

    if (jsRedirect === rsRedirect) {
      console.log(`  ✅ PASS [c&e] ${label} → ${rsRedirect || '(no redirect)'}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL [c&e] ${label}`);
      console.error(`    JS→WASM: ${jsRedirect}`);
      console.error(`    RS c&e:  ${rsRedirect}`);
      failed++;
    }
  } catch (err) {
    console.error(`  ❌ FAIL [c&e] ${label}: ${err.message}`);
    failed++;
  }
}

// ════════════════════════════════════════════════════════════════════════
// Run tests
// ════════════════════════════════════════════════════════════════════════

console.log('\n--- Bytecode Parity Tests (JS compiler vs Rust compiler) ---\n');

// Simple literals
testBytecodeParity('"hello" redirect');
testBytecodeParity('42 redirect');
testBytecodeParity('-10 redirect');
testBytecodeParity('-32768 redirect');

// Arithmetic
testBytecodeParity('10 5 +');
testBytecodeParity('10 5 -');
testBytecodeParity('10 5 *');
testBytecodeParity('10 5 /');
testBytecodeParity('10 5 %');
testBytecodeParity('32767 1 +');

// Comparisons
testBytecodeParity('10 5 >');
testBytecodeParity('10 5 <');
testBytecodeParity('10 5 >=');
testBytecodeParity('10 5 <=');

// Stack ops
testBytecodeParity('dup drop swap over rot');

// URL ops
testBytecodeParity('dup host redirect');
testBytecodeParity('dup path redirect');
testBytecodeParity('dup proto redirect');

// String ops
testBytecodeParity('"hello" " world" concat redirect');
testBytecodeParity('"abc" "b" "x" replace redirect');
testBytecodeParity('"abc" "b" "x" replace-all redirect');

// Comparison & logic
testBytecodeParity('"a" "a" eq');
testBytecodeParity('"a" "b" neq');
testBytecodeParity('"hello" "he" starts-with');
testBytecodeParity('"hello" "lo" ends-with');
testBytecodeParity('"hello" "ell" contains');
testBytecodeParity('1 1 and');
testBytecodeParity('1 0 or');
testBytecodeParity('1 not');

// Type predicates
testBytecodeParity('"hello" str?');
testBytecodeParity('42 int?');
testBytecodeParity('{ "a" } arr?');
testBytecodeParity('[ drop ] quot?');

// Word definitions
testBytecodeParity(': double ( n -- n ) dup + ; 5 double redirect');
testBytecodeParity(': add-pre ( s -- s ) "pre-" swap concat ; path add-pre redirect');

// Nested blocks
testBytecodeParity('1 [ drop "yes" redirect ] [ drop "no" redirect ] choose');
testBytecodeParity('[ [ drop ] call ] call');

// Array literals
testBytecodeParity('{ "a" "b" "c" } 1 get redirect');
testBytecodeParity('{ "outer" { "inner0" "inner1" } } 1 get 1 get redirect');

// Higher-order words
testBytecodeParity('{ "a" "b" } [ dup concat ] map "/" join redirect');
testBytecodeParity('{ "a" "b" "c" } [ "b" eq not ] filter "/" join redirect');
testBytecodeParity('path-segments [ dup concat ] each redirect');

// URL params
testBytecodeParity('"key" param redirect');
testBytecodeParity('"key" has-param');
testBytecodeParity('"key" "val2" set-param redirect');
testBytecodeParity('"key" remove-param redirect');
testBytecodeParity('param-keys');
testBytecodeParity('param-values');
testBytecodeParity('path-segments');
testBytecodeParity('"." split');

// Array ops
testBytecodeParity('{ "x" "y" "z" } len');
testBytecodeParity('{ "x" "y" "z" } 1 get');
testBytecodeParity('{ "x" "y" "z" } "-" join');
testBytecodeParity('{ "x" "y" "z" } indices');
testBytecodeParity('{ "a" "b" "c" "d" } 1 2 slice');
testBytecodeParity('{ "a" "b" } { "1" "2" } zip');

// Flow control
testBytecodeParity('1 [ "yes" redirect ] call-if');
testBytecodeParity('dup host redirect');
testBytecodeParity('skip');

// Comments
testBytecodeParity('# this is a comment\n"hello" redirect');
testBytecodeParity('( inline comment ) "hello" redirect');

// Negative numbers
testBytecodeParity('-1 redirect');
testBytecodeParity('-32768 1 -');
testBytecodeParity('40000');

console.log('\n--- compile_and_execute End-to-End Parity Tests ---\n');

// Basic redirects
testCompileAndExecute('dup host "example.com" eq [ drop "https://new.com" redirect ] call-if', 'https://new.com');
testCompileAndExecute('"hello" " world" concat redirect', 'hello world');
testCompileAndExecute('dup path redirect', '/foo/bar');
testCompileAndExecute('dup host redirect', 'example.com');
testCompileAndExecute('dup proto redirect', 'https');

// Arithmetic
testCompileAndExecute('10 5 + redirect', '15');
testCompileAndExecute('32767 1 + redirect', '-32768');
testCompileAndExecute('-32768 1 - redirect', '32767');
testCompileAndExecute('1000 40 * redirect', '-25536');
testCompileAndExecute('10 0 /', null, 'Division by zero');

// Word definitions
testCompileAndExecute(': double ( n -- n ) dup concat ; "ab" double redirect', 'abab');
testCompileAndExecute(': force-https ( url -- url ) "http://" "https://" replace-all ; dup force-https redirect', 'https://example.com/foo/bar?key=val');

// Array + higher-order
testCompileAndExecute('{ "apple" "banana" "cherry" } 2 get redirect', 'cherry');
testCompileAndExecute('path-segments [ dup concat ] map "/" join redirect', 'foofoo/barbar');
testCompileAndExecute('path-segments [ "bar" eq not ] filter "/" join redirect', 'foo');

// Comparisons
testCompileAndExecute('-10 -5 < redirect', '1');
testCompileAndExecute('5 -10 < redirect', '0');

// Params
testCompileAndExecute('"key" param redirect', 'val');
testCompileAndExecute('"key" has-param redirect', '1');
testCompileAndExecute('"missing" has-param redirect', '0');

// Skip
testCompileAndExecute('skip', null);

// Type predicates
testCompileAndExecute('"hello" str? redirect', '1');

console.log(`\n${'═'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n⚠️  ${failed} test(s) failed!`);
  process.exit(1);
} else {
  console.log('✅ All tests passed!');
}
