import { Interpreter } from './interpreter.js';
import { Compiler } from './compiler.js';
import { VM } from './vm.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execute: wasmExecute } = require('./rs-vm/pkg-node/rs_vm.js');

const interpreter = new Interpreter({ maxOps: 1000000 });
const iterations = 1000;

function benchmark(name, source, url) {
  console.log(`\n--- Benchmark: ${name} ---`);
  console.log(`Source: ${source}`);
  
  // AST Interpretation
  const startAst = performance.now();
  let astRes;
  for (let i = 0; i < iterations; i++) {
    astRes = interpreter.execute(source, url);
  }
  const endAst = performance.now();
  const astDuration = (endAst - startAst) / iterations;
  
  // Compilation
  const startComp = performance.now();
  const { bytecode, constants } = Compiler.compile(source);
  const endComp = performance.now();
  const compDuration = endComp - startComp;

  // JS VM Execution
  const startVm = performance.now();
  let vmRes;
  for (let i = 0; i < iterations; i++) {
    vmRes = VM.execute(bytecode, constants, url);
  }
  const endVm = performance.now();
  const vmDuration = (endVm - startVm) / iterations;

  // WASM VM Execution
  const options = { maxOps: 1000000, maxCallStack: 1000 };
  const startWasm = performance.now();
  let wasmRes;
  for (let i = 0; i < iterations; i++) {
    wasmRes = wasmExecute(bytecode, constants, url, options);
  }
  const endWasm = performance.now();
  const wasmDuration = (endWasm - startWasm) / iterations;

  console.log(`AST Interpreter: ${astDuration.toFixed(4)} ms/op (ops: ${astRes.ops})`);
  console.log(`Compiler:        ${compDuration.toFixed(4)} ms (one-time)`);
  console.log(`JS VM:           ${vmDuration.toFixed(4)} ms/op (ops: ${vmRes.ops})`);
  console.log(`WASM VM:         ${wasmDuration.toFixed(4)} ms/op (ops: ${wasmRes.ops})`);
  console.log(`Speedup (JS VM):   ${(astDuration / vmDuration).toFixed(2)}x`);
  console.log(`Speedup (WASM):    ${(astDuration / wasmDuration).toFixed(2)}x`);
  console.log(`WASM vs JS VM:     ${(vmDuration / wasmDuration).toFixed(2)}x faster`);
}

console.log(`Running benchmarks with ${iterations} iterations each...`);

// 1. Simple tight loop (simulated by repeated ops)
benchmark(
  "Simple Arithmetic/Stack Ops",
  "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 drop drop drop drop drop drop drop drop drop drop drop drop drop drop drop drop drop drop drop drop",
  "https://example.com"
);

// 2. String Manipulation
benchmark(
  "URL Processing & String Concat",
  "dup host swap path concat swap proto concat swap port concat redirect",
  "https://very-long-subdomain.example.com:8080/path/to/some/resource?query=1"
);

// 3. Recursion
benchmark(
  "Deep Recursion (strip-foo)",
  `: strip-foo ( str -- str' )
     dup "foo" contains
     [ "foo" "" replace strip-foo ]
     [ ]
     choose ;
   path strip-foo redirect`,
  "https://example.com/foo/foo/foo/foo/foo/foo/foo/foo/foo/foo/bar"
);

// 4. Array Operations (MAP/FILTER)
benchmark(
  "Array MAP/FILTER Pipeline",
  "path-segments [ dup len 2 eq swap \"foo\" eq or ] filter [ dup concat ] map \"/\" join redirect",
  "https://example.com/a/bb/ccc/foo/dd/eeee/foo/f"
);

// 5. Large Array Zip/Join
benchmark(
  "Large Array ZIP & JOIN",
  `{ "1" "2" "3" "4" "5" "6" "7" "8" "9" "10" } 
   { "a" "b" "c" "d" "e" "f" "g" "h" "i" "j" } 
   zip [ "-" join ] map "," join redirect`,
  "https://example.com"
);
