# Page Redirector Extension

Page Redirector is a Firefox/Chrome browser extension that allows users to automatically intercept and manipulate navigation requests. It supports basic wildcard matches, regular expressions, and dynamic routing using a Forth-like interpreter and stack bytecode VM (for cases that require much more fine grained control than would be possible w/ regular expressions alone).

## Main Features
- **Wildcard & Regex Redirection**: Drop or swap parameters using regular expressions w/ capture groups.
- **Single Page Application Support**: Intercepts dynamic soft-URL changes and not just full page changes.
- **Basic Rule Analytics and Encryption**: Hit counters to determine active rules, and AES-256 encryption supporting secure rule export/import sharing.
- **Bytecode Virtual Machine**: Conditionally rewrite parameters or URLs using a simple stack bytecode language. Includes inline loop debugging, basic autocompletion of built-in commands, and debugging within the Options UI.

---

## Changelog

**1.1–1.10** — Core extension infrastructure: regex `gmi`/`gmv` flag support, precompiled regex caching, SPA soft-URL monitoring via the `tabs` API, obfuscated source URL display (hidden until editing, with hover tooltip), rule hit counters, JSON import/export with optional AES-256 encryption, keepalive alarm for background persistence, dynamic version readout, global timed pause, and quick-access popup UI.

**1.11–1.16** — Stack language VM: introduced Forth-like bytecode interpreter for URL routing with pre-filter regex support; UI warnings for built-in word overrides; autocomplete overlay with dictionary hints; compiled VM engine with custom compiler and integer opcode dispatch; interactive step debugger with live stack/state visualisation.

**1.17–1.20** — VM correctness and parity: fixed compiler dropping grouped logic blocks; added nested array literal support for both AST and compiled paths; tightened regex to `gmv` (ES2024 unicodeSets); persistent auto-migration for compiled bytecode via `COMPILER_VERSION`; rewrote step debugger to CPS trampolining for correct `each`/`map`/`filter` step-through; O(n) `MAKE_ARRAY`; case-sensitive token values; `get` out-of-bounds now returns `undefined`; added `zip` for element-wise array pairing.

1.21 : Simplified lexer token types for single-character syntax tokens — token `type` is now the character itself (`:`, `;`, `[`, `]`, `{`, `}`) instead of a verbose name (e.g. `COLON`), so the type is never longer than the value. Added four non-destructive type-predicate words (`str?`, `int?`, `arr?`, `quot?`) to both the AST interpreter and compiled VM; each peeks the top of the stack and pushes a `1`/`0` flag without consuming the value. Assigned opcodes `STR_Q` (38), `INT_Q` (39), `ARR_Q` (40), `QUOT_Q` (41) and renumbered the Strings opcode group to 45–48 to accommodate them.

1.22 : Fixed compiler failing to bind block opcodes accurately due to outdated verbose token bounds (`COLON` vs `:`), and fixed lexer string boundary rules omitting the `?` character needed for predicates like `str?`. Added comprehensive test-vm assertions verifying stack neutrality and parsing capability for all type conditions.

1.23 : VM execution loop is completely non-recursive for stack-safety (no JS recursion during `FILTER`/`MAP`/`EACH`); frame-based iteration on explicit call stack. Configurable `maxCallStack` limit (default 16, min 8, max 64). Bug in `EACH` where iteration results were incorrectly popped from the stack.

1.24 : **Generator-based Debugger** for both the bytecode VM and AST interpreter; replaced CPS with generators (`yield*`). Higher-order words (`MAP`, `FILTER`, `EACH`) use non-recursive iteration loops.

1.25 : **WASM VM Engine** Rust-based execution alternative; 16-bit opcode arguments (up to 65,535).

1.26 : **Per-Rule Execution Engine Selection**: allow choosing between JS VM, WASM VM, or AST Interpreter for each rule.