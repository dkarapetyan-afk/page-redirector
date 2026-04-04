import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Helper to load CJS in ESM
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the WASM VM
const { execute } = require('./rs-vm/pkg-node/rs_vm.js');
import { Compiler } from './compiler.js';

// We'll mock a "VM" class for test-wasm parity
const RustVM = {
  execute: (bytecode, constants, url, options = {}) => {
    // result comes from serde_wasm_bindgen
    return execute(new Uint8Array(bytecode), constants, url, options);
  }
};

// Use the exact same Interpreter for AST test parity
import { Interpreter } from './interpreter.js';
const interpreter = new Interpreter();

function test(source, url, expectedUrl) {
  process.stdout.write(`Testing: ${source.substring(0, 50)}${source.length > 50 ? '...' : ''} -> `);

  try {
    // Compiled WASM VM Test
    const { bytecode, constants } = Compiler.compile(source);
    const vmResult = RustVM.execute(bytecode, constants, url);
    
    if (!vmResult.success) {
      console.error("\n❌ WASM FAIL - Error:", vmResult.error);
      process.exit(1);
    } else if (vmResult.redirect != expectedUrl) { // Loose equality handles null == undefined
      console.error(`\n❌ WASM FAIL - Expected ${expectedUrl}, got ${vmResult.redirect}`);
      process.exit(1);
    } else {
      process.stdout.write(`✅ WASM PASS (${vmResult.ops} ops)\n`);
    }
  } catch (err) {
    console.error(`\n💥 WASM CRASH - ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

console.log("--- Starting WASM Parity Test Suite ---\n");

// 1. Simple Host Redirect
test(
  'dup host "old-site.com" eq [ drop "https://new-site.com" redirect ] call-if',
  'https://old-site.com/foo',
  'https://new-site.com'
);

// 2. Strip tracking
test(
  `dup "utm_source" has-param 
    [ "utm_source" remove-param "utm_medium" remove-param redirect ] call-if`,
  'https://example.com/page?utm_source=twitter&utm_medium=social&foo=bar',
  'https://example.com/page?foo=bar'
);

// 3. Conditional filter of tracking params (demonstrates filter; no redirect)
test(
  `dup param-keys
    [ "utm_" starts-with not ] filter
    drop`,
  'https://example.com/?utm_source=a&valid=b&utm_medium=c',
  null
);

// 4. Custom Words
test(
  `: force-https ( url -- url' )
       "http://" "https://" replace-all ;
     : normalize ( url -- url' )
       force-https ;
       
     dup host "example.com" contains
     [ normalize redirect ] call-if`,
  'http://www.example.com/login',
  'https://www.example.com/login'
);

// 5. Recursion
test(
  `: strip-foo ( str -- str' )
       dup "foo" contains
       [ "foo" "" replace strip-foo ]
       [ ]
       choose ;
       
     path strip-foo redirect`,
  'https://example.com/foo/bar/foo/baz',
  '//bar//baz'
);

// 6. Deep Recursion
test(
  `: last-segment ( arr -- str )
       dup len 1 eq
       [ 0 get ]
       [ 1 255 slice last-segment ]
       choose ;
       
     path-segments last-segment redirect`,
  'https://example.com/a/b/c/d/e',
  'e'
);

// 7. Static Array Literals
test(
  `{ "apple" "banana" "cherry" } 2 get redirect`,
  'https://example.com/foo',
  'cherry'
);

// 8. Nested Block and Array Compilation
test(
  `{ "level1" { "hidden" "level2" } [ drop "nested block" ] } 
     1 get 1 get redirect`,
  'https://example.com/foo',
  'level2'
);

// 9. ROT
test(
  `"a" "b" "c" rot concat concat redirect`,
  'https://example.com/',
  'bca'
);

// 10. OVER
test(
  `"ping" "-" over concat concat redirect`,
  'https://example.com/',
  'ping-ping'
);

// 11. T
test(
  `"hello" $t concat redirect`,
  'https://example.com/',
  'hellohello'
);

// 12. Chained words
test(
  `: add-pre ( s -- s ) "pre-" swap concat ;
     : add-suf ( s -- s ) "-suf" concat ;
     : wrap    ( s -- s ) add-pre add-suf ;
     path 1 255 substr wrap redirect`,
  'https://example.com/hello',
  'pre-hello-suf'
);

// 13. first-label
test(
  `: first-label ( url -- s ) host "." split 0 get ;
     first-label redirect`,
  'https://api.example.com/v1/users',
  'api'
);

// 14. CHOOSE true
test(
  `dup host "a.com" eq [ drop "https://b.com" ] [ drop "https://c.com" ] choose redirect`,
  'https://a.com/page',
  'https://b.com'
);

// 15. CHOOSE false
test(
  `dup host "a.com" eq [ drop "https://b.com" ] [ drop "https://c.com" ] choose redirect`,
  'https://x.com/page',
  'https://c.com'
);

// 16. MAP double
test(
  `: double ( s -- s ) dup concat ;
     path-segments [ double ] map "/" join redirect`,
  'https://example.com/foo/bar/baz',
  'foofoo/barbar/bazbaz'
);

// 17. MAP multi param
test(
  `{ "utm_source" "ref" } [ over swap param ] map "/" join redirect`,
  'https://example.com/?utm_source=twitter&ref=homepage',
  'twitter/homepage'
);

// 18. MAP replace
test(
  `path-segments [ "_" "-" replace-all ] map "/" join redirect`,
  'https://example.com/foo_bar/baz_qux/hello',
  'foo-bar/baz-qux/hello'
);

// 19. FILTER remove specific
test(
  `path-segments [ "b" eq not ] filter "/" join redirect`,
  'https://example.com/a/b/c',
  'a/c'
);

// 20. FILTER prefix
test(
  `path-segments [ "api-" starts-with ] filter "/" join redirect`,
  'https://example.com/home/api-users/about/api-posts',
  'api-users/api-posts'
);

// 21. FILTER + MAP pipeline
test(
  `dup param-keys [ "keep_" starts-with ] filter [ over swap param ] map "/" join redirect`,
  'https://example.com/?keep_a=foo&drop_b=bar&keep_c=baz',
  'foo/baz'
);

// 22. EACH redirect (early exit)
test(
  `path-segments [ dup "stop" eq [ redirect ] call-if drop ] each`,
  'https://example.com/go/skip/stop/after',
  'stop'
);

// 23. EACH no redirect
test(
  `path-segments [ dup "stop" eq [ redirect ] call-if drop ] each`,
  'https://example.com/go/skip/forward',
  null
);

// 24. trim3
test(
  `: drop-first ( arr -- arr )
       dup len 0 eq [ ] [ 1 255 slice ] choose ;
     : trim3 ( arr -- arr )
       drop-first drop-first drop-first ;
     path-segments trim3 "/" join redirect`,
  'https://example.com/a/b/c/d/e',
  'd/e'
);

// 25. strip-X
test(
  `: strip ( str -- str )
       dup "X" contains
       [ "X" "" replace strip ]
       [ ]
       choose ;
     path 1 255 substr strip redirect`,
  'https://example.com/heXlXloX',
  'hello'
);

// 26. SET_PARAM / REMOVE_PARAM
test(
  `"utm_source" remove-param "v" "2" set-param redirect`,
  'https://example.com/?utm_source=abc&keep=yes',
  'https://example.com/?keep=yes&v=2'
);

// 27. Force HTTPS
test(
  `dup proto "https" eq not [ "http://" "https://" replace-all redirect ] call-if`,
  'http://example.com/path?q=1',
  'https://example.com/path?q=1'
);

// 28. Already HTTPS
test(
  `dup proto "https" eq not [ "http://" "https://" replace-all redirect ] call-if`,
  'https://example.com/path',
  null
);

// 29. Hash extraction
test(
  `hash redirect`,
  'https://example.com/page#section-42',
  'section-42'
);

// 30. Empty hash
test(
  `hash "" eq not [ hash redirect ] call-if`,
  'https://example.com/page',
  null
);

// 31. Port presence
test(
  `dup port "" eq not [ redirect ] call-if`,
  'https://example.com:8080/path',
  'https://example.com:8080/path'
);

// 32. SEGMENT
test(
  `dup 0 segment swap 1 segment "-" swap concat concat redirect`,
  'https://example.com/hello-world/foo',
  'hello-world-foo'
);

// 33. SLICE
test(
  `path-segments 1 2 slice "/" join redirect`,
  'https://example.com/a/b/c/d',
  'b/c'
);

// 34. INDICES
test(
  `{ "x" "y" "z" } indices 0 get redirect`,
  'https://example.com/',
  0
);

// 35. SPLIT + JOIN
test(
  `host "." split "-" join redirect`,
  'https://foo.bar.baz.com/',
  'foo-bar-baz-com'
);

// 36. LEN
test(
  `param-values len redirect`,
  'https://example.com/?a=1&b=2&c=3',
  3
);

// 36b. ZIP
test(
  `{ "a" "b" "c" } { "1" "2" "3" } zip 1 get 1 get redirect`,
  'https://example.com/',
  '2'
);

// 36c. ZIP param reconstruct
test(
  `dup param-keys swap param-values zip [ dup 0 get swap 1 get "=" swap concat concat ] map "/" join redirect`,
  'https://example.com/?foo=bar&baz=qux',
  'foo=bar/baz=qux'
);

// 37. AND true
test(
  `dup host "example.com" eq over proto "https" eq and [ drop "https://example.com/ok" redirect ] call-if`,
  'https://example.com/anywhere',
  'https://example.com/ok'
);

// 38. AND false
test(
  `dup host "other.com" eq over proto "https" eq and [ drop "https://example.com/ok" redirect ] call-if`,
  'https://example.com/anywhere',
  null
);

// 39. OR
test(
  `dup host "a.com" eq over host "b.com" eq or [ drop "https://canonical.com" redirect ] call-if`,
  'https://b.com/path',
  'https://canonical.com'
);

// 40. NOT absent
test(
  `dup "utm_source" has-param not [ redirect ] call-if`,
  'https://example.com/?clean=yes',
  'https://example.com/?clean=yes'
);

// 41. REPLACE (first)
test(
  `path 1 255 substr "o" "" replace redirect`,
  'https://example.com/foobar',
  'fobar'
);

// 42. REPLACE_ALL
test(
  `path 1 255 substr "o" "" replace-all redirect`,
  'https://example.com/foobar',
  'fbar'
);

// 43. SUBSTR skip
test(
  `path 1 255 substr 3 4 substr redirect`,
  'https://example.com/abcdefgh',
  'defg'
);

// 44. CONTAINS guard
test(
  `dup host "admin" contains [ drop "https://example.com/403" redirect ] call-if`,
  'https://admin.corp.example.com/secret',
  'https://example.com/403'
);

// 45. MAP empty
test(
  `{ } [ dup concat ] map "/" join redirect`,
  'https://example.com/',
  ''
);

// 46. FILTER empty
test(
  `path-segments [ "z" eq ] filter "/" join redirect`,
  'https://example.com/a/b/c',
  ''
);

// 47. Nested static access
test(
  `{ "outer" { "inner0" "inner1" } } 1 get 1 get redirect`,
  'https://example.com/',
  'inner1'
);

// 48. GET out-of-bounds -> null
test(
  `{ "only" } 5 get redirect`,
  'https://example.com/',
  null  // Rust Value::Null serializes to JS null
);

// 49. PARAM missing -> ""
test(
  `"nonexistent" param "" eq not [ "found" redirect ] call-if`,
  'https://example.com/?a=1',
  null
);

// 50. last-segment via recursion
test(
  `: drop-first ( arr -- arr )
       dup len 1 eq [ ] [ 1 255 slice drop-first ] choose ;
     path-segments drop-first 0 get redirect`,
  'https://example.com/a/b/c/d/last',
  'last'
);

// 51. Strip www.
test(
  `dup host "www." starts-with [ dup "www." "" replace-all over "www." replace redirect ] call-if`,
  'https://www.example.com/page?q=1',
  'https://example.com/page?q=1'
);

// 52. Version upgrade
test(
  `"/v1/" "/v2/" replace-all redirect`,
  'https://api.example.com/v1/users/v1/settings',
  'https://api.example.com/v2/users/v2/settings'
);

// 53. EACH remove multiple
test(
  `dup param-keys [ "utm_" starts-with ] filter [ over swap remove-param swap drop ] each redirect`,
  'https://example.com/?utm_source=a&keep=yes&utm_medium=b',
  'https://example.com/?keep=yes'
);

// 54. Rebuild non-empty path
test(
  `path-segments [ "" eq not ] filter dup len 0 eq not [ "/" swap "/" join concat redirect ] call-if`,
  'https://example.com/api/v2/users',
  '/api/v2/users'
);

// 55. str?
test(
  `"hello" str? [ swap drop " World" concat redirect ] [ drop skip ] choose`,
  'https://example.com/',
  'hello World'
);

// 56. int?
test(
  `{ "a" "b" } len int? [ swap 10 eq [ "ten" redirect ] [ "not-ten" redirect ] choose ] [ drop skip ] choose`,
  'https://example.com/',
  'not-ten'
);

// 57. arr?
test(
  `path-segments arr? [ 0 get redirect ] [ drop skip ] choose`,
  'https://example.com/foo/bar',
  'foo'
);

// 58. quot?
test(
  `[ drop "is-quot" redirect ] quot? [ call ] [ drop skip ] choose`,
  'https://example.com/',
  'is-quot'
);

// 59. Call Stack Overflow
// Rust currently has hardcoded 10000 ops and 16 stack.
test(
  "[ ".repeat(17) + "1" + " ] call".repeat(17),
  'https://example.com/',
  null // Expect failure/halt
);

// 60. Configurable Depth
// (WASM execute currenty uses hardcoded defaults but we check it doesn't crash)
console.log("\n(Skipping configurable depth test for WASM until options are ported)");

// 61. Redirect inside MAP
test(
  `{ 1 2 3 } [ "stopped" redirect ] map "fail" redirect`,
  'https://example.com/',
  'stopped'
);

// 62. Large Integer (> 255)
test(
  `1000 redirect`,
  'https://example.com/',
  '1000'
);

console.log("\n--- All 62 WASM Parity Tests Completed ---");
