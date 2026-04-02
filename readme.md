# Page Redirector Extension

Page Redirector is a Firefox/Chrome browser extension that allows users to automatically intercept and manipulate navigation requests. It supports basic wildcard matches, regular expressions, and dynamic routing using a Forth-like interpreter and stack bytecode VM (for cases that require much more fine grained control than would be possible w/ regular expressions alone).

## Main Features
- **Wildcard & Regex Redirection**: Drop or swap parameters using regular expressions w/ capture groups.
- **Single Page Application Support**: Intercepts dynamic soft-URL changes and not just full page changes.
- **Basic Rule Analytics and Encryption**: Hit counters to determine active rules, and AES-256 encryption supporting secure rule export/import sharing.
- **Bytecode Virtual Machine**: Conditionally rewrite parameters or URLs using a simple stack bytecode language. Includes inline loop debugging, basic autocompletion of built-in commands, and debugging within the Options UI.

---

## Changelog
1.1 : Added 'gmi' flags to all regex instances

1.2 : Hidden/obfuscated source match strings in the UI so they are only visible when editing.

1.3 : Precompiled regex caching for faster request handling.

1.4 : Support for single-page applications (SPAs) by monitoring soft URL changes via the `tabs` API.

1.5 : HTML tooltip on hover to reveal the obfuscated source URL pattern.

1.6 : Rule hit counter (tracks how many times each rule has been triggered) and import/export functionality to backup and share rules as JSON files.

1.7 : Optional AES-256 encryption for exported rules using Web Crypto API. Export saves as .json (plain) or .enc (encrypted). Import auto-detects file type.

1.8 : Keepalive alarm to periodically wake up background script and ensure extension stays active.

1.9 : Dynamic version readout.

1.10 : Global timed pause feature and quick-access extension popup UI.

1.11 : Stack-based bytecode VM interpreter for URL routing with optional pre-filtering regex.

1.12 : UI warning when overriding built-in stack words in the bytecode editor.

1.13 : Basic autocomplete overlay providing dictionary matches and tooltips.

1.14 : Issue w/ URL lowercasing.

1.15 : Compiled VM script engine option utilizing custom compiler and integer opcode dispatching for better performance.

1.16 : Interactive debugger interface tracking live state and stack evaluation variables UI.

1.17 : Compiler token bug causing grouped logic blocks to be dropped, added parsing support for nested static Array literal declarations for AST interpreter and VM.

1.18 : Changed regex engine matches to use "gmv" flags (adding strict ES2024 unicodeSets support and enforcing case-sensitivity). Persistent auto-migration architecture for compiled VM scripts, allowing background.js to detect outdated VM bytecode states and seamlessly recompiling them utilizing `COMPILER_VERSION` identifiers.