import { Interpreter } from './interpreter.js';
import { VM } from './vm.js';
import { Compiler, COMPILER_VERSION } from './compiler.js';
import init, { execute as wasmExecute } from './rs-vm/pkg-web/rs_vm.js';

const vm = new Interpreter();

let rules = []; // Rules wrapped with compiled Regex objects
let wasmReady = false;
let executionEngine = 'bytecode-js'; // Default engine

// Load and initialize WASM VM for web environment
init().then(() => {
    wasmReady = true;
    console.log("WASM VM Initialized Successfully");
}).catch(e => {
    console.error("Failed to initialize WASM VM:", e);
});

function processRules(rawRules) {
    let needsSave = false;
    
    const mapped = rawRules.map(rule => {
        let compiledRegex = null;
        if (rule.type === 'regex') {
            try {
                compiledRegex = new RegExp(rule.source, 'gmv');
            } catch (e) {
                console.error("Failed to compile regex rule:", rule.source, e);
            }
        } else if (rule.type === 'wildcard') {
            const escapeRegex = (string) => string.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
            const regexStr = "^" + rule.source.split("*").map(escapeRegex).join(".*") + "$";
            try {
                compiledRegex = new RegExp(regexStr, 'gmv');
            } catch (e) {
                console.error("Failed to compile wildcard rule:", rule.source, e);
            }
        } else if ((rule.type === 'bytecode' || rule.type === 'compiled') && rule.matchRegex) {
            try {
                compiledRegex = new RegExp(rule.matchRegex, 'gmv');
            } catch (e) {
                console.error("Failed to compile matchRegex rule:", rule.matchRegex, e);
            }
        }
        
        if (rule.type === 'compiled') {
            if (rule.compilerVersion !== COMPILER_VERSION) {
                console.log(`Auto-migrating compiled rule [${rule.id}] to version ${COMPILER_VERSION}`);
                try {
                    const comp = Compiler.compile(rule.source);
                    rule.bytecode = comp.bytecode;
                    rule.constants = comp.constants;
                    rule.compilerVersion = COMPILER_VERSION;
                    needsSave = true;
                } catch(e) {
                    console.error("Failed to migrate compile rule:", e);
                }
            }
        }
        
        return { ...rule, _compiledRegex: compiledRegex };
    });
    
    if (needsSave) {
        const cleanRules = mapped.map(r => {
            const copy = {...r};
            delete copy._compiledRegex;
            return copy;
        });
        browser.storage.local.set({ redirectRules: cleanRules });
    }
    
    return mapped;
}

let pauseUntil = 0;

// Load rules initially
browser.storage.local.get(["redirectRules", "pauseUntil", "executionEngine"]).then((data) => {
    if (data.redirectRules) {
        rules = processRules(data.redirectRules);
    }
    if (data.pauseUntil !== undefined) {
        pauseUntil = data.pauseUntil;
    }
    if (data.executionEngine) {
        executionEngine = data.executionEngine;
    }
});

// Update rules and settings when storage changes
browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
        if (changes.redirectRules) {
            rules = processRules(changes.redirectRules.newValue || []);
        }
        if (changes.pauseUntil !== undefined) {
            pauseUntil = changes.pauseUntil.newValue || 0;
        }
        if (changes.executionEngine) {
            executionEngine = changes.executionEngine.newValue || 'bytecode-js';
        }
    }
});

function ensureProtocol(url) {
    if (!/^https?:\/\//i.test(url)) {
        return 'https://' + url;
    }
    return url;
}

function checkRedirect(url) {
    if (Date.now() < pauseUntil) return null;

    for (const rule of rules) {
        if (!rule.enabled) continue;

        let shouldRedirect = false;

        if (rule.type === "exact") {
            shouldRedirect = url === rule.source || url === rule.source + '/';
        } else if ((rule.type === "regex" || rule.type === "wildcard") && rule._compiledRegex) {
            rule._compiledRegex.lastIndex = 0;
            shouldRedirect = rule._compiledRegex.test(url);
        } else if (rule.type === "bytecode" || rule.type === "compiled") {
            if (rule._compiledRegex) {
                rule._compiledRegex.lastIndex = 0;
                if (!rule._compiledRegex.test(url)) {
                    continue; // Skip execution if regex doesn't match
                }
            }
            try {
                let res;
                if (rule.type === "compiled") {
                    if (executionEngine === 'bytecode-wasm' && wasmReady) {
                        res = wasmExecute(new Uint8Array(rule.bytecode), rule.constants, url, {});
                    } else if (executionEngine === 'ast') {
                         res = vm.execute(rule.source, url);
                    } else {
                        res = VM.execute(rule.bytecode, rule.constants, url);
                    }
                } else {
                    res = vm.execute(rule.source, url);
                }
                if (res.success && res.redirect) {
                    let destination = ensureProtocol(res.redirect);
                    if (url !== destination) {
                        return { destination, ruleId: rule.id };
                    }
                }
            } catch (e) {
                console.error("VM Execution Error:", e);
            }
            continue;
        }

        if (shouldRedirect) {
            let destination = rule.destination;

            // If it's a regex/wildcard rule, we support capture groups in the destination like $1, $2
            if ((rule.type === "regex" || rule.type === "wildcard") && rule._compiledRegex) {
                rule._compiledRegex.lastIndex = 0;
                destination = url.replace(rule._compiledRegex, rule.destination);
            }

            // Ensure the destination has a protocol prefix
            destination = ensureProtocol(destination);

            // Prevent redirect loops
            if (url !== destination) {
                return { destination, ruleId: rule.id };
            }
        }
    }
    return null;
}

function incrementHitCount(ruleId) {
    browser.storage.local.get("redirectRules").then((data) => {
        const storedRules = data.redirectRules || [];
        const rule = storedRules.find(r => r.id === ruleId);
        if (rule) {
            rule.hitCount = (rule.hitCount || 0) + 1;
            browser.storage.local.set({ redirectRules: storedRules });
        }
    });
}

function handleRequest(details) {
    const result = checkRedirect(details.url);
    if (result) {
        console.log(`Web Request Redirecting: ${details.url} -> ${result.destination}`);
        incrementHitCount(result.ruleId);
        return { redirectUrl: result.destination };
    }
    return {};
}

// Ensure the listener is registered for main frame requests initially
browser.webRequest.onBeforeRequest.addListener(
    handleRequest,
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking"]
);

// Monitor all URL changes (e.g. SPAs, pushState) via the tabs API
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // We only care when the URL changes.
    if (changeInfo.url) {
        const result = checkRedirect(changeInfo.url);
        if (result) {
            console.log(`Soft Redirecting (tabs API): ${changeInfo.url} -> ${result.destination}`);
            incrementHitCount(result.ruleId);
            browser.tabs.update(tabId, { url: result.destination });
        }
    }
});


// Keepalive alarm to periodically wake up the background script
browser.alarms.create("keepAlive", { periodInMinutes: 0.5 });
browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "keepAlive") {
        console.debug("Keepalive alarm triggered.");
    }
});
