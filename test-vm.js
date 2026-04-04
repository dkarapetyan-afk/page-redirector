import { Interpreter } from './interpreter.js';
import { Compiler } from './compiler.js';
import { VM } from './vm.js';

const vm = new Interpreter();

function test(source, url, expectedUrl) {
  console.log(`\nTesting: ${source}`);
  console.log(`URL: ${url}`);

  // AST Test
  const astResult = vm.execute(source, url);
  if (!astResult.success) {
    console.error("AST FAIL - Error:", astResult.error);
  } else if (astResult.redirect !== expectedUrl) {
    console.error(`AST FAIL - Expected ${expectedUrl}, got ${astResult.redirect}`);
  } else {
    console.log(`AST PASS - Redirects to: ${astResult.redirect} (ops: ${astResult.ops})`);
  }

  // Compiled VM Test
  try {
    const { bytecode, constants } = Compiler.compile(source);
    const vmResult = VM.execute(bytecode, constants, url);
    if (!vmResult.success) {
      console.error("COMPILER FAIL - Error:", vmResult.error);
    } else if (vmResult.redirect !== expectedUrl) {
      console.error(`COMPILER FAIL - Expected ${expectedUrl}, got ${vmResult.redirect}`);
    } else {
      console.log(`COMPILER PASS - Redirects to: ${vmResult.redirect} (ops: ${vmResult.ops})`);
    }
  } catch (err) {
    console.error(`COMPILER CRASH - ${err.message}`);
  }
}

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
  null // filter leaves non-utm keys on stack but we don't redirect
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
// Removes all occurrences of "foo" one by one recursively
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

// 6. Deep Recursion (Testing budget/stack limits conceptually)
// Recursively consume segments of a path until only the last one is left
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

// ─── Stack Manipulation ───────────────────────────────────────────────

// 9. ROT: [a,b,c] → [b,c,a]
// After rot: stack is "b","c","a". concat→"c"+"a"="ca", concat→"b"+"ca"="bca"
test(
  `"a" "b" "c" rot concat concat redirect`,
  'https://example.com/',
  'bca'
);

// 10. OVER: [x,y] → [x,y,x]; used to copy URL below a key for PARAM
// "ping" "-" over → "ping" "-" "ping"; concat→"-ping"; concat→"ping-ping"
test(
  `"ping" "-" over concat concat redirect`,
  'https://example.com/',
  'ping-ping'
);

// 11. T: alias for DUP (peek top without consuming it)
// Verify T is identical to DUP
test(
  `"hello" $t concat redirect`,
  'https://example.com/',
  'hellohello'
);

// ─── Custom Words: Chaining & Scope ──────────────────────────────────

// 12. Three-level word chain: add-pre → add-suf → wrap
// path = "/hello", substr(1,255) = "hello"
test(
  `: add-pre ( s -- s ) "pre-" swap concat ;
     : add-suf ( s -- s ) "-suf" concat ;
     : wrap    ( s -- s ) add-pre add-suf ;
     path 1 255 substr wrap redirect`,
  'https://example.com/hello',
  'pre-hello-suf'
);

// 13. Word calling another word (no explicit recursion)
// host → "api.example.com", split "." → ["api","example","com"], 0 get → "api"
test(
  `: first-label ( url -- s ) host "." split 0 get ;
     first-label redirect`,
  'https://api.example.com/v1/users',
  'api'
);

// ─── CHOOSE ──────────────────────────────────────────────────────────

// 14. CHOOSE true branch
// dup host "a.com" eq → 1; true block drops url, pushes "https://b.com"; redirect
test(
  `dup host "a.com" eq
     [ drop "https://b.com" ]
     [ drop "https://c.com" ]
     choose redirect`,
  'https://a.com/page',
  'https://b.com'
);

// 15. CHOOSE false branch (same code, different input)
test(
  `dup host "a.com" eq
     [ drop "https://b.com" ]
     [ drop "https://c.com" ]
     choose redirect`,
  'https://x.com/page',
  'https://c.com'
);

// ─── MAP ─────────────────────────────────────────────────────────────

// 16. MAP: double each path segment string
// ["foo","bar","baz"] → ["foofoo","barbar","bazbaz"] → join "/"
test(
  `: double ( s -- s ) dup concat ;
     path-segments [ double ] map "/" join redirect`,
  'https://example.com/foo/bar/baz',
  'foofoo/barbar/bazbaz'
);

// 17. MAP: extract multiple named params using over-swap-param
// Stack when block runs: [url, key]. OVER→[url,key,url]. SWAP→[url,url,key]. PARAM→[url,value].
// MAP pops value; url remains for next iteration.
test(
  `{ "utm_source" "ref" } [ over swap param ] map "/" join redirect`,
  'https://example.com/?utm_source=twitter&ref=homepage',
  'twitter/homepage'
);

// 18. MAP: replace underscores with dashes in each segment
test(
  `path-segments [ "_" "-" replace-all ] map "/" join redirect`,
  'https://example.com/foo_bar/baz_qux/hello',
  'foo-bar/baz-qux/hello'
);

// ─── FILTER ──────────────────────────────────────────────────────────

// 19. FILTER: remove one specific segment
test(
  `path-segments [ "b" eq not ] filter "/" join redirect`,
  'https://example.com/a/b/c',
  'a/c'
);

// 20. FILTER: keep only segments starting with a given prefix
test(
  `path-segments [ "api-" starts-with ] filter "/" join redirect`,
  'https://example.com/home/api-users/about/api-posts',
  'api-users/api-posts'
);

// 21. FILTER + MAP pipeline: keep keys starting with "keep_", extract their values
// param-keys → filter → map(over swap param) → join
test(
  `dup param-keys [ "keep_" starts-with ] filter
     [ over swap param ] map
     "/" join redirect`,
  'https://example.com/?keep_a=foo&drop_b=bar&keep_c=baz',
  'foo/baz'
);

// ─── EACH ────────────────────────────────────────────────────────────

// 22. EACH: redirect on first matching segment (early exit)
test(
  `path-segments [ dup "stop" eq [ redirect ] call-if drop ] each`,
  'https://example.com/go/skip/stop/after',
  'stop'
);

// 23. EACH does NOT redirect when no item matches
// No redirect fires → redirectUrl stays null
test(
  `path-segments [ dup "stop" eq [ redirect ] call-if drop ] each`,
  'https://example.com/go/skip/forward',
  null
);

// ─── Recursion ────────────────────────────────────────────────────────

// 24. Recursive drop-first via CHOOSE, called 3× in a word
// ["a","b","c","d","e"].slice(1,256) x3 → ["d","e"]
test(
  `: drop-first ( arr -- arr )
       dup len 0 eq [ ] [ 1 255 slice ] choose ;
     : trim3 ( arr -- arr )
       drop-first drop-first drop-first ;
     path-segments trim3 "/" join redirect`,
  'https://example.com/a/b/c/d/e',
  'd/e'
);

// 25. Recursive strip-all: remove every occurrence of a substring
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

// ─── URL Mutation ────────────────────────────────────────────────────

// 26. SET_PARAM adds a param; REMOVE_PARAM removes another
test(
  `"utm_source" remove-param "v" "2" set-param redirect`,
  'https://example.com/?utm_source=abc&keep=yes',
  'https://example.com/?keep=yes&v=2'
);

// 27. Force HTTPS via replace-all when proto != "https"
test(
  `dup proto "https" eq not
     [ "http://" "https://" replace-all redirect ] call-if`,
  'http://example.com/path?q=1',
  'https://example.com/path?q=1'
);

// 28. Already HTTPS → no redirect fires
test(
  `dup proto "https" eq not
     [ "http://" "https://" replace-all redirect ] call-if`,
  'https://example.com/path',
  null
);

// ─── URL Component Extraction ─────────────────────────────────────────

// 29. Hash extraction
test(
  `hash redirect`,
  'https://example.com/page#section-42',
  'section-42'
);

// 30. Empty hash → no redirect
test(
  `hash "" eq not [ hash redirect ] call-if`,
  'https://example.com/page',
  null
);

// 31. Conditional redirect on port presence
test(
  `dup port "" eq not [ redirect ] call-if`,
  'https://example.com:8080/path',
  'https://example.com:8080/path'
);

// 32. SEGMENT opcode: get individual path segments by index
// Segment 0 = "hello-world", segment 1 = "foo"; concat with "-"
test(
  `dup 0 segment swap 1 segment "-" swap concat concat redirect`,
  'https://example.com/hello-world/foo',
  'hello-world-foo'
);

// ─── Array Operations ────────────────────────────────────────────────

// 33. SLICE: take a window of segments
test(
  `path-segments 1 2 slice "/" join redirect`,
  'https://example.com/a/b/c/d',
  'b/c'
);

// 34. INDICES: produce [0,1,2,...] from array, join to verify
test(
  `{ "x" "y" "z" } indices 0 get redirect`,
  'https://example.com/',
  0
);

// 35. SPLIT + JOIN with non-slash delimiter
test(
  `host "." split "-" join redirect`,
  'https://foo.bar.baz.com/',
  'foo-bar-baz-com'
);

// 36. LEN on param-values (redirects to integer)
test(
  `param-values len redirect`,
  'https://example.com/?a=1&b=2&c=3',
  3
);

// 36b. ZIP: pair two arrays element-wise, extract first pair's second element
test(
  `{ "a" "b" "c" } { "1" "2" "3" } zip 1 get 1 get redirect`,
  'https://example.com/',
  '2'
);

// 36c. ZIP with param-keys and param-values: rebuild key=val strings
test(
  `dup param-keys swap param-values zip [ dup 0 get swap 1 get "=" swap concat concat ] map "/" join redirect`,
  'https://example.com/?foo=bar&baz=qux',
  'foo=bar/baz=qux'
);

// ─── Logic Operators ─────────────────────────────────────────────────

// 37. AND: both conditions must hold
test(
  `dup host "example.com" eq
     over proto "https" eq
     and
     [ drop "https://example.com/ok" redirect ] call-if`,
  'https://example.com/anywhere',
  'https://example.com/ok'
);

// 38. AND short-circuits to 0 if first condition false
test(
  `dup host "other.com" eq
     over proto "https" eq
     and
     [ drop "https://example.com/ok" redirect ] call-if`,
  'https://example.com/anywhere',
  null
);

// 39. OR: at least one condition holds
test(
  `dup host "a.com" eq
     over host "b.com" eq
     or
     [ drop "https://canonical.com" redirect ] call-if`,
  'https://b.com/path',
  'https://canonical.com'
);

// 40. NOT: redirect when param is absent
test(
  `dup "utm_source" has-param not
     [ redirect ] call-if`,
  'https://example.com/?clean=yes',
  'https://example.com/?clean=yes'
);

// ─── String Operations ───────────────────────────────────────────────

// 41. REPLACE vs REPLACE_ALL: replace replaces only first occurrence
test(
  `path 1 255 substr "o" "" replace redirect`,
  'https://example.com/foobar',
  'fobar'
);

// 42. REPLACE_ALL: replace every occurrence
test(
  `path 1 255 substr "o" "" replace-all redirect`,
  'https://example.com/foobar',
  'fbar'
);

// 43. SUBSTR: extract middle portion
// path = "/abcdefgh", substr(3, 4) = "defg" (offset 3 from index 1 = skip "/abc")
test(
  `path 1 255 substr 3 4 substr redirect`,
  'https://example.com/abcdefgh',
  'defg'
);

// 44. CONTAINS as guard
test(
  `dup host "admin" contains
     [ drop "https://example.com/403" redirect ] call-if`,
  'https://admin.corp.example.com/secret',
  'https://example.com/403'
);

// ─── Edge / Boundary Cases ────────────────────────────────────────────

// 45. MAP over empty array yields empty array → join yields ""
test(
  `{ } [ dup concat ] map "/" join redirect`,
  'https://example.com/',
  ''
);

// 46. FILTER yields empty → join yields ""
test(
  `path-segments [ "z" eq ] filter "/" join redirect`,
  'https://example.com/a/b/c',
  ''
);

// 47. Static nested array access: { "a" { "b" "c" } } 1 get 0 get
test(
  `{ "outer" { "inner0" "inner1" } } 1 get 1 get redirect`,
  'https://example.com/',
  'inner1'
);

// 48. GET out-of-bounds returns null
test(
  `{ "only" } 5 get redirect`,
  'https://example.com/',
  undefined
);

// 49. PARAM missing key returns ""
test(
  `"nonexistent" param "" eq not [ "found" redirect ] call-if`,
  'https://example.com/?a=1',
  null
);

// 50. Deep path-segments → last segment via recursive drop-first
test(
  `: drop-first ( arr -- arr )
       dup len 1 eq [ ] [ 1 255 slice drop-first ] choose ;
     path-segments drop-first 0 get redirect`,
  'https://example.com/a/b/c/d/last',
  'last'
);

// ─── Compound Real-World Patterns ────────────────────────────────────

// 51. Canonical host redirect: strip "www." prefix
// host = "www.example.com"; "www." "" replace-all + reconstruct
test(
  `dup host "www." starts-with
     [ dup "www." "" replace-all
       over "www." replace
       redirect ] call-if`,
  'https://www.example.com/page?q=1',
  'https://example.com/page?q=1'
);

// 52. Version upgrade: rewrite /v1/ → /v2/ in path
test(
  `"/v1/" "/v2/" replace-all redirect`,
  'https://api.example.com/v1/users/v1/settings',
  'https://api.example.com/v2/users/v2/settings'
);

// 53. Strip all UTM params via param-keys filter + EACH remove
// After filtering keys, iterate and remove each one
test(
  `dup param-keys [ "utm_" starts-with ] filter
     [ over swap remove-param swap drop ] each
     redirect`,
  'https://example.com/?utm_source=a&keep=yes&utm_medium=b',
  'https://example.com/?keep=yes'
);

// 54. Rebuild path: join only non-empty segments after filter
test(
  `path-segments [ "" eq not ] filter
     dup len 0 eq not
     [ "/" swap "/" join concat redirect ] call-if`,
  'https://example.com/api/v2/users',
  '/api/v2/users'
);

// ─── Type Predicates ──────────────────────────────────────────────────

// 55. str? (peek, push 1 if string, else 0)
test(
  `"hello" str? 
     [ swap drop " World" concat redirect ] 
     [ drop skip ] 
     choose`,
  'https://example.com/',
  'hello World'
);

// 56. int? (peek, push 1 if number, else 0)
// array length produces a number; check int?
test(
  `{ "a" "b" } len int?
     [ swap 10 eq [ "ten" redirect ] [ "not-ten" redirect ] choose ] 
     [ drop skip ] 
     choose`,
  'https://example.com/',
  'not-ten'
);

// 57. arr? (peek, push 1 if array, else 0)
// url is consumed by path-segments, so stack is just [ arr ]
test(
  `path-segments arr?
     [ 0 get redirect ]
     [ drop skip ]
     choose`,
  'https://example.com/foo/bar',
  'foo'
);

// 58. quot? (peek, push 1 if quotation, else 0)
// stack is [ url, q1 ], so 'call' pops q1 and executes it (which drops url)
test(
  `[ drop "is-quot" redirect ] quot?
     [ call ]
     [ drop skip ]
     choose`,
  'https://example.com/',
  'is-quot'
);

// ─── Call Stack Depth & Configuration ────────────────────────────────

// 59. Call Stack Overflow (default limit 16)
// We nest 17 levels of calls.
const nested17 = "[ ".repeat(17) + "1" + " ] call".repeat(17);
test(
  nested17,
  'https://example.com/',
  null // Expect failure/halt
);

// 60. Configurable Call Stack (set to 32, then nest 20)
console.log("\nTesting Configurable maxCallStack (32)...");
const nested20 = "[ ".repeat(20) + "\"pass\" redirect" + " ] call".repeat(20);
try {
  const source = nested20;
  const url = 'https://example.com/';
  // Note: We need a manual test call here because our `test` helper doesn't take options yet
  const interpreter = new Interpreter({ maxCallStack: 32 });
  const astResult = interpreter.execute(source, url);
  if (astResult.success && astResult.redirect === "pass") {
    console.log("AST PASS - Configured Depth (32) worked for 20 nests");
  } else {
    console.error("AST FAIL - Configured Depth (32) failed", astResult.error);
  }

  const { bytecode, constants } = Compiler.compile(source);
  const vmResult = VM.execute(bytecode, constants, url, { maxCallStack: 32 });
  if (vmResult.success && vmResult.redirect === "pass") {
    console.log("VM PASS - Configured Depth (32) worked for 20 nests");
  } else {
    console.error("VM FAIL - Configured Depth (32) failed", vmResult.error);
  }
} catch (err) {
  console.error("CONFIG TEST CRASH:", err.message);
}

// 61. Redirect inside Iteration (MAP)
// Test that REDIRECT immediately exits and doesn't finish the map
test(
  `{ 1 2 3 } [ "stopped" redirect ] map "fail" redirect`,
  'https://example.com/',
  'stopped'
);