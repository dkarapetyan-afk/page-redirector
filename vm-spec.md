# Page Redirector — Stack Language & Interpreter Specification

## 1. Overview

This document specifies a Forth-like stack language for URL matching and rewriting, and a direct interpreter that executes it at runtime. The system is designed for use as a "Custom Code" rule type in the Page Redirector Firefox extension.

### Design Goals

| Goal | Mechanism |
|---|---|
| **No code injection** | No `eval()` or `new Function()`. Execution runs on either a token-walking AST loop or a fast integer bytecode switch. |
| **Guaranteed termination** | Configurable instruction budget (default: 1,024-10,000 ops). Call stack depth capped limit. |
| **Bounded memory** | Stack depth capped. String values capped. |
| **Minimal attack surface** | The interpreter receives only the URL string. No access to `browser.*`, DOM, network, or globals. |
| **Dual Architecture** | Supports both dynamic Interpretation and pre-compiled Virtual Machine paths. |

---

## 2. Language

The language is a **concatenative, stack-oriented DSL** inspired by Forth. Programs are sequences of **words** separated by whitespace. Each word either pushes a value onto the stack or pops operands and pushes a result.

### 2.1 Syntax

```
program     = item* ;
item        = word_def | word | literal | comment ;

word_def    = ":" IDENT word* ";" ;          (* define a custom word *)
word        = BUILTIN_WORD | IDENT ;         (* execute a word *)

literal     = STRING | NUMBER | array_lit | quotation ;
array_lit   = "{" literal* "}" ;             (* array literal *)
quotation   = "[" item* "]" ;               (* reified code block *)

STRING      = '"' ( ~'"' | '\"' )* '"' ;
NUMBER      = [0-9]+ ;
IDENT       = [a-zA-Z_$][a-zA-Z0-9_$-]* ;

comment     = "(" ~")"* ")" ;                (* inline comment *)
            | "#" ~newline* newline ;         (* line comment *)
```

There is **no complex grammar** — the interpreter tokenizes the source into words and literals, looks up each word in a dictionary, and executes it immediately. This is the Forth model.

### 2.2 Stack Notation

Stack effects are documented using the standard Forth convention:

```
( before -- after )
```

For example, `host ( url -- hostname )` means: pops a URL string, pushes the hostname.

### 2.3 Execution Model

1. The VM is initialized with the input URL on the stack.
2. Words are executed left to right. Each word operates on the stack.
3. The VM halts when it encounters `redirect`, `skip`, an unknown word, or exceeds the op budget.
4. If the result is `redirect`, the top of stack is returned as the destination URL.
5. If the result is `skip` or budget exhaustion, `null` is returned (no redirect).

### 2.4 String Case Sensitivity

All string values, particularly the initial URL payload and subsequent extracted query parameters (`has-param`, `param`), **strictly retain their original casing**. This differs from traditional systems that blindly lowercase input, preventing malicious breakage of base64 hashes or case-sensitive tracking keys.

### 2.5 Truthiness

Values are evaluated for truthiness by combinators like `call-if` and `choose`:

| Type | Truthy | Falsy |
|---|---|---|
| **Integer** | Non-zero | `0` |
| **String** | Non-empty | `""` |
| **Array** | Non-empty | `{}` |

### 2.6 Type System

The VM operates on three types:

| Type | Representation | Notes |
|---|---|---|
| **String** | JavaScript `string` | Max 4,096 bytes |
| **Integer** | JavaScript `number` | Used for booleans, indices, lengths |
| **Array** | JavaScript `Array` | Ordered list of strings or integers. Max 256 elements. |
| **Quotation** | Token range `{start, end}` | A reified code block — a reference to a range of tokens in the program. Pushed by `[…]`, executed by `call`. |

---

## 3. Built-in Words

### 3.1 Stack Manipulation

| Word | Stack Effect | Description |
|---|---|---|
| `dup` | `( a -- a a )` | Duplicate top |
| `drop` | `( a -- )` | Discard top |
| `swap` | `( a b -- b a )` | Swap top two |
| `over` | `( a b -- a b a )` | Copy second to top |
| `rot` | `( a b c -- b c a )` | Rotate third to top |
| `$t` | `( -- a )` | Peek: push a copy of the top without popping |

### 3.2 URL Decomposition

All expect a URL string on top of the stack.

| Word | Stack Effect | Description |
|---|---|---|
| `host` | `( url -- hostname )` | Extract hostname |
| `path` | `( url -- pathname )` | Extract pathname |
| `proto` | `( url -- protocol )` | Extract protocol |
| `port` | `( url -- port )` | Extract port |
| `hash` | `( url -- fragment )` | Extract hash fragment |
| `param` | `( url key -- value )` | Get query param value, or `""` |
| `segment` | `( url n -- seg )` | Get Nth path segment (0-indexed) |
| `has-param` | `( url key -- flag )` | `1` if param exists, `0` otherwise |

### 3.3 Comparison

| Word | Stack Effect | Description |
|---|---|---|
| `eq` | `( a b -- flag )` | Equal |
| `neq` | `( a b -- flag )` | Not equal |
| `starts-with` | `( str prefix -- flag )` | String starts with prefix |
| `ends-with` | `( str suffix -- flag )` | String ends with suffix |
| `contains` | `( haystack needle -- flag )` | String contains substring |

### 3.4 Logic

| Word | Stack Effect | Description |
|---|---|---|
| `and` | `( a b -- flag )` | Logical AND |
| `or` | `( a b -- flag )` | Logical OR |
| `not` | `( a -- flag )` | Logical NOT |

### 3.5 String Operations

| Word | Stack Effect | Description |
|---|---|---|
| `concat` | `( a b -- ab )` | Concatenate two strings |
| `replace` | `( str search repl -- result )` | Replace first occurrence |
| `replace-all` | `( str search repl -- result )` | Replace all occurrences |
| `substr` | `( str start len -- result )` | Extract substring |

### 3.6 URL Mutation

| Word | Stack Effect | Description |
|---|---|---|
| `set-param` | `( url key val -- url' )` | Set query param |
| `remove-param` | `( url key -- url' )` | Remove query param |

### 3.7 String → Array

| Word | Stack Effect | Description |
|---|---|---|
| `split` | `( str delim -- arr )` | Split string by delimiter |
| `param-keys` | `( str -- arr )` | Parse as URL, return query param keys |
| `param-values` | `( str -- arr )` | Parse as URL, return query param values |
| `path-segments` | `( str -- arr )` | Split by `/`, remove empties |

### 3.8 Array Operations

| Word | Stack Effect | Description |
|---|---|---|
| `len` | `( arr -- n )` | Array length |
| `get` | `( arr n -- elem )` | Get element at index; returns `undefined` if out of bounds |
| `join` | `( arr delim -- str )` | Join array into string |
| `indices` | `( arr -- arr )` | Array of integer indices `[0, 1, 2, …]` |
| `slice` | `( arr start count -- arr )` | Sub-array |
| `zip` | `( arr arr -- arr )` | Pair two arrays element-wise into `[[a0,b0],[a1,b1],…]`, truncated to the shorter length |

### 3.9 Control Flow & Combinators

All control flow uses quotations (reified code blocks):

| Word | Stack Effect | Description |
|---|---|---|
| `call` | `( quot -- … )` | Execute a quotation |
| `call-if` | `( flag quot -- … )` | Execute quotation only if flag is truthy |
| `choose` | `( flag quot-t quot-f -- … )` | Execute `quot-t` if truthy, `quot-f` if falsy |
| `map` | `( arr quot -- arr' )` | Apply quotation to each element, collect results |
| `filter` | `( arr quot -- arr' )` | Keep elements where quotation pushes truthy |
| `each` | `( arr quot -- … )` | Execute quotation for each element (no collect) |

### 3.10 Termination

| Word | Stack Effect | Description |
|---|---|---|
| `redirect` | `( url -- )` | Halt VM; return top as redirect destination |
| `skip` | `( -- )` | Halt VM; return null (no redirect) |

### 3.11 Type Predicates

All four words **peek** the top of stack (leaving it intact) and push a `1`/`0` flag:

| Word | Stack Effect | Description |
|---|---|---|
| `str?` | `( a -- a 0\|1 )` | `1` if top is a string |
| `int?` | `( a -- a 0\|1 )` | `1` if top is an integer |
| `arr?` | `( a -- a 0\|1 )` | `1` if top is an array |
| `quot?` | `( a -- a 0\|1 )` | `1` if top is a quotation |

### 3.12 Custom Words

Define reusable words with `: name ... ;`

```
: strip-tracking ( url -- url' )
  "utm_source" remove-param
  "utm_medium" remove-param
  "utm_campaign" remove-param ;
```

Custom words can call any defined word, **including themselves** (recursion is allowed). Termination is guaranteed at runtime by the op budget (`maxOps`) and the call stack depth limit (max 16). The compiler does not reject recursive programs.

---

## 4. Lexer

### 4.1 Tokenization

The lexer converts source text into a flat array of tokens. Each token has a type and a value:

| Token Type | Example | Value |
|---|---|---|
| `STRING` | `"hello"` | `"hello"` (exact casing preserved) |
| `NUMBER` | `42` | `42` |
| `WORD` | `host`, `dup`, `my-word` | The word name |
| `:` | `:` | — |
| `;` | `;` | — |
| `[` | `[` | — |
| `]` | `]` | — |
| `{` | `{` | — |
| `}` | `}` | — |

Comments (`( … )` and `# …`) are stripped during tokenization.

### 4.2 Error Handling

The lexer reports errors with line and column numbers:

```json
{
  "success": false,
  "errors": [
    { "line": 3, "col": 5, "message": "Unterminated string literal" }
  ]
}
```

---

## 5. Interpreter

### 5.1 Architecture

The system features two concurrent execution models which share the identical syntax:

**Model A: AST Interpreter (Legacy / Live Eval)**
```
Source Text → Lexer → Token Array → Interpreter (direct execution)
```
The interpreter walks the object token array and executes each token dynamically.

**Model B: Compiled Bytecode VM (Performance)**
```
Source Text → Lexer → Compiler → { Bytecode Array, Constant Pool } → VM (integer switch loop)
```
The compiler strips strings to a constant pool, assigns integer Opcodes to all words, flattens branches into Jump instructions, and routes user-defined words into subroutine blocks. The VM executes purely over `Uint8Array` style datasets without evaluating strings in runtime.

### 5.2 State

| Component | Type | Initial | Limit |
|---|---|---|---|
| `ip` | int | `0` | `bytecode.length` |
| `stack` | array | `[url]` | 64 entries |
| `call_stack` | array of `ip` | `[]` | depth 16 |
| `ops` | int | `0` | `maxOps` |
| `maxOps` | int | `10000` | — |

> **Note**: The stack is initialized with the input URL already on it.

### 5.3 Execution Loop

The interpreter uses **trampolined CPS** — each operation returns a thunk (a zero-argument function) instead of calling the continuation directly. A flat `while` loop drives execution at **constant stack depth**, regardless of program length or recursion depth.

```javascript
function next() {
    if (ip >= tokens.length || ops >= maxOps) return null;
    const token = tokens[ip++];
    ops++;
    return () => execute(token, next);   // return thunk, don't call
}

// Trampoline: flat loop, constant stack depth
function trampoline(thunk) {
    while (typeof thunk === 'function') {
        thunk = thunk();
    }
    return thunk;
}

// Start execution
trampoline(next);
```

Each operation (built-in word, custom word, combinator) receives the `next` continuation and returns `() => next()` to continue, or `null` to halt.

### 5.4 Quotation Execution

When a combinator (`call`, `call-if`, `choose`, `map`, `filter`, `each`) executes a quotation:

1. Push the current `ip` onto the call stack.
2. Set `ip` to the quotation's `start`.
3. Return a thunk that steps through the body tokens via `next`.
4. When `ip` reaches `end`, pop the call stack, restore `ip`, and return `() => next()` to resume the caller.

Quotations can be nested. Each nesting level uses a call stack frame.

### 5.5 Custom Word Execution

When a user-defined word is encountered:

1. Look up the word in the dictionary to get `{start, end}`.
2. Push the current `ip` and locals onto the call stack.
3. Set `ip` to `start`, allocate fresh locals.
4. Return a thunk that steps through the body tokens via `next`.
5. When `ip` reaches `end`, pop the call stack, restore `ip` and locals, and return `() => next()` to resume the caller.

Recursion is allowed — the call stack depth limit (16) and op budget guarantee termination.

### 5.6 Runtime Configuration

The op budget is configurable via `browser.storage.local`:

```json
{ "vmSettings": { "maxOps": 1024 } }
```

| Setting | Default | Range | Description |
|---|---|---|---|
| `maxOps` | `1024` | 256–65,535 | Max tokens executed per invocation |

### 5.7 Error Conditions

| Condition | Behavior |
|---|---|
| Unknown word | Halt, return `null` |
| Stack underflow | Halt, return `null` |
| Stack overflow (>64) | Halt, return `null` |
| String exceeds 4,096 bytes | Truncated |
| Array exceeds 256 elements | Truncated |
| Op budget exceeded | Halt, return `null`. Log rule ID and count. |
| Invalid URL in decomposition | Push `""` |
| Call stack overflow (>16) | Halt, return `null` |

---

## 6. Storage & Serialization

A bytecode rule generated in `browser.storage.local`:

```json
{
  "id": "abc123",
  "type": "compiled",
  "source": "dup host \"old.com\" eq [ drop \"https://new.com\" redirect ] call-if",
  "matchRegex": "^https?://.*",
  "bytecode": [ 10, 20, ... ],
  "constants": [ "old.com", "https://new.com" ],
  "enabled": true
}
```

- `type`: Either `"bytecode"` (AST) or `"compiled"` (Compiled VM).
- `bytecode` / `constants`: Attached payload automatically compiled by the UI when the user selects `"compiled"`.
- `matchRegex`: An optional native generic regex wrapper ensuring the VM code blocks don't even trigger evaluation if it's the wrong URL domain class.

---

## 7. Integration Points

### 7.1 Options Page

- New rule types: **"AST Script"** and **"Compiled VM Script"**.
- UI features an active **Hover IntelliSense** dropdown overlay dynamically matching incomplete words to stack hints.
- Features a **Live Debugger Panel** equipped to intercept Mock URLs, stepping forwards opcode-by-opcode visually.

### 7.2 Background Script

- `checkRedirect()`: Depending on `type`, pushes evaluation into `vm.execute(bytecode, constants, url)` natively without allocating tree strings.

### 7.3 Export/Import

- Exported JSON includes `source` (human-readable Forth).
- On import, no recompilation needed — the source IS the program.

---

## 9. Examples

### 9.1 Simple Host Redirect

```forth
( Redirect old-site.com to new-site.com )
dup host "old-site.com" eq
[ drop "https://new-site.com" redirect ] call-if
```

### 9.2 Strip Tracking Parameters

```forth
dup "utm_source" has-param
[ "utm_source" remove-param
  "utm_medium" remove-param
  "utm_campaign" remove-param
  redirect ] call-if
```

### 9.3 Conditional Path Rewrite

```forth
dup host "docs.example.com" eq
over path "/v1/" starts-with
and
[ "/v1/" "/v2/" replace redirect ] call-if
```

### 9.4 Custom Words

```forth
: strip-tracking ( url -- url' )
  "utm_source" remove-param
  "utm_medium" remove-param
  "utm_campaign" remove-param ;

: is-old-domain ( url -- url flag )
  dup host "old.example.com" eq
  over host "legacy.example.com" eq
  or ;

is-old-domain
[ drop "https://new.example.com"
  swap path concat
  strip-tracking
  redirect ] call-if
```

### 9.5 Filter Tracking Params

```forth
( Filter to non-utm keys, then use each+remove-param to strip them from the URL )
dup param-keys
[ "utm_" starts-with ] filter
[ over swap remove-param swap drop ] each
redirect
```

### 9.6 Block Path Segments

```forth
( Redirect if any segment is "admin" or "internal" )
dup path-segments
[ dup "admin" eq swap "internal" eq or ] filter
len 0 neq
[ drop "https://blocked.example.com" redirect ] call-if
```

### 9.7 Composable Words

```forth
: strip-tracking ( url -- url' )
  "utm_source" remove-param
  "utm_medium" remove-param
  "utm_campaign" remove-param ;

: force-https ( url -- url' )
  "http://" "https://" replace-all ;

: normalize ( url -- url' )
  force-https strip-tracking ;

dup host "example.com" contains
[ normalize redirect ] call-if
```

### 9.8 Choose Between Two Actions

```forth
dup host "old.com" eq
[ drop "https://new.com" ]
[ drop "https://fallback.com" ]
choose
redirect
```

### 9.9 Map Transformation

```forth
( Replace hyphens with underscores in all path segments )
dup path-segments
[ "-" "_" replace-all ] map
"/" join
redirect
```

### 9.10 Each with Side Effects

```forth
( Remove each tracking param individually )
dup param-keys
[ dup "utm_" starts-with
  [ over swap remove-param ] call-if
] each
redirect
```
