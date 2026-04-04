import { Interpreter } from './interpreter.js';
import { Compiler, COMPILER_VERSION } from './compiler.js';
import { VM } from './vm.js';

document.addEventListener('DOMContentLoaded', () => {
    // Show extension version
    const versionEl = document.getElementById('app-version');
    if (versionEl) {
        versionEl.textContent = 'v' + browser.runtime.getManifest().version;
    }

    const form = document.getElementById('add-rule-form');
    const rulesContainer = document.getElementById('rules-container');
    const template = document.getElementById('rule-template');

    // Edit mode elements
    const editingRuleIdInput = document.getElementById('editing-rule-id');
    const submitRuleBtn = document.getElementById('submit-rule-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const ruleTypeInput = document.getElementById('rule-type');
    const ruleSourceInput = document.getElementById('rule-source');
    const ruleSourceCode = document.getElementById('rule-source-code');
    const bytecodeWarning = document.getElementById('bytecode-warning');
    const bytecodeMatchGroup = document.getElementById('bytecode-match-group');
    const ruleBytecodeMatch = document.getElementById('rule-bytecode-match');
    const ruleDestInput = document.getElementById('rule-destination');
    const destGroup = document.getElementById('destination-group');
    const ruleSourceLabel = document.getElementById('rule-source-label');

    const debugPanel = document.getElementById('debug-panel');
    const debugUrlInput = document.getElementById('debug-url');
    const debugBtnStart = document.getElementById('debug-btn-start');
    const debugBtnStep = document.getElementById('debug-btn-step');
    const debugBtnRun = document.getElementById('debug-btn-run');
    const debugBtnStop = document.getElementById('debug-btn-stop');
    const debugReadout = document.getElementById('debug-readout');
    const debugInstruction = document.getElementById('debug-instruction');
    const debugStatus = document.getElementById('debug-status');
    const debugStack = document.getElementById('debug-stack');

    let debugSession = null;
    let debugIsCompiled = false;
    let rules = [];

    const vm = new Interpreter();
    function checkBytecodeWarnings() {
        if (!ruleSourceCode || !bytecodeWarning) return;
        const code = ruleSourceCode.value;
        if (!code) {
            bytecodeWarning.style.display = 'none';
            return;
        }
        const res = vm.tokenize(code);
        if (!res.success) {
            bytecodeWarning.style.display = 'none';
            return;
        }
        const overridden = [];
        const tokens = res.tokens;
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type === 'COLON' && i + 1 < tokens.length && tokens[i+1].type === 'WORD') {
                const name = tokens[i+1].value;
                if (vm.dictionary[name] && !overridden.includes(name)) {
                    overridden.push(name);
                }
            }
        }
        if (overridden.length > 0) {
            bytecodeWarning.textContent = `Warning: Overriding built-in word(s): ${overridden.join(', ')}`;
            bytecodeWarning.style.display = 'block';
        } else {
            bytecodeWarning.style.display = 'none';
        }
    }
    
    let bytecodeWarningTimer;
    
    // Autocomplete Logic
    const autocompleteOverlay = document.getElementById('autocomplete-overlay');
    let mirrorDiv = document.createElement('div');
    mirrorDiv.id = 'mirror-div';
    document.body.appendChild(mirrorDiv);
    
    let acItems = [];
    let activeAcIndex = -1;
    let acCurrentWordStart = -1;
    const builtinDocs = Interpreter.getDocs();

    function getCaretCoordinates(element, position) {
        const properties = [
            'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
            'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
            'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
            'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust',
            'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
            'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize', 'MozTabSize'
        ];

        const computed = window.getComputedStyle(element);
        properties.forEach(prop => {
            mirrorDiv.style[prop] = computed[prop];
        });

        mirrorDiv.style.width = element.offsetWidth + 'px';
        mirrorDiv.textContent = element.value.substring(0, position);
        const span = document.createElement('span');
        span.textContent = element.value.substring(position) || '.';
        mirrorDiv.appendChild(span);

        return {
            top: span.offsetTop + parseInt(computed['borderTopWidth']),
            left: span.offsetLeft + parseInt(computed['borderLeftWidth']),
            height: parseInt(computed['lineHeight'])
        };
    }

    function renderAutocomplete(word) {
        if (!word) {
            hideAutocomplete();
            return;
        }

        acItems = Object.keys(builtinDocs).filter(k => k.startsWith(word.toLowerCase()));
        
        if (acItems.length === 0) {
            hideAutocomplete();
            return;
        }

        if (autocompleteOverlay) {
            autocompleteOverlay.textContent = '';
            activeAcIndex = 0;

            acItems.forEach((item, index) => {
                const div = document.createElement('div');
                div.className = 'ac-item' + (index === 0 ? ' active' : '');
                
                const wordSpan = document.createElement('span');
                wordSpan.className = 'ac-word';
                wordSpan.textContent = item;
                
                const docsSpan = document.createElement('span');
                docsSpan.className = 'ac-docs';
                docsSpan.textContent = builtinDocs[item];
                
                div.appendChild(wordSpan);
                div.appendChild(docsSpan);
                
                div.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    insertAutocomplete(item);
                });
                autocompleteOverlay.appendChild(div);
            });

            const coords = getCaretCoordinates(ruleSourceCode, ruleSourceCode.selectionEnd);
            autocompleteOverlay.style.top = (coords.top + coords.height + 4) + 'px';
            autocompleteOverlay.style.left = coords.left + 'px';
            autocompleteOverlay.style.display = 'block';
        }
    }

    function hideAutocomplete() {
        if (autocompleteOverlay) autocompleteOverlay.style.display = 'none';
        acItems = [];
        activeAcIndex = -1;
    }

    function insertAutocomplete(text) {
        if (acCurrentWordStart === -1) return;
        const val = ruleSourceCode.value;
        const end = ruleSourceCode.selectionEnd;
        ruleSourceCode.value = val.substring(0, acCurrentWordStart) + text + " " + val.substring(end);
        
        // Reset cursor
        ruleSourceCode.selectionStart = ruleSourceCode.selectionEnd = acCurrentWordStart + text.length + 1;
        hideAutocomplete();
        ruleSourceCode.focus();
        checkBytecodeWarnings();
    }

    function updateAcSelection() {
        if (!autocompleteOverlay) return;
        const itemEls = autocompleteOverlay.children;
        for (let i = 0; i < itemEls.length; i++) {
            if (i === activeAcIndex) {
                itemEls[i].classList.add('active');
                itemEls[i].scrollIntoView({ block: 'nearest' });
            } else {
                itemEls[i].classList.remove('active');
            }
        }
    }

    if (ruleSourceCode) {
        ruleSourceCode.addEventListener('input', (e) => {
            clearTimeout(bytecodeWarningTimer);
            bytecodeWarningTimer = setTimeout(checkBytecodeWarnings, 300);

            // Autocomplete handling
            const val = ruleSourceCode.value;
            const end = ruleSourceCode.selectionEnd;
            const textBeforeCursor = val.substring(0, end);
            const match = textBeforeCursor.match(/[\w$-]+$/);

            if (match) {
                acCurrentWordStart = match.index;
                renderAutocomplete(match[0]);
            } else {
                hideAutocomplete();
            }
        });

        ruleSourceCode.addEventListener('keydown', (e) => {
            if (autocompleteOverlay && autocompleteOverlay.style.display === 'block' && acItems.length > 0) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    activeAcIndex = (activeAcIndex + 1) % acItems.length;
                    updateAcSelection();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    activeAcIndex = (activeAcIndex - 1 + acItems.length) % acItems.length;
                    updateAcSelection();
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    insertAutocomplete(acItems[activeAcIndex]);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    hideAutocomplete();
                }
            }
        });

        ruleSourceCode.addEventListener('blur', hideAutocomplete);
    }

    // Load rules from storage
    function loadRules() {
        browser.storage.local.get("redirectRules").then((data) => {
            rules = data.redirectRules || [];
            renderRules();
        });
    }

    // Save rules to storage
    function saveRules(newRules) {
        return browser.storage.local.set({ redirectRules: newRules }).then(() => {
            rules = newRules;
            renderRules();
        });
    }

    // Generate unique ID based on timestamp and randomness
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // Render the rules list
    function renderRules() {
        rulesContainer.innerHTML = '';

        if (rules.length === 0) {
            rulesContainer.innerHTML = '<div class="empty-state">No redirect rules set. Add one above!</div>';
            return;
        }

        rules.forEach((rule, index) => {
            const clone = template.content.cloneNode(true);
            const card = clone.querySelector('.rule-card');

            clone.querySelector('.type-badge').textContent = rule.type;
            const sourceUrlEl = clone.querySelector('.source-url');
            sourceUrlEl.textContent = '*'.repeat(rule.source.length);
            sourceUrlEl.title = rule.source; // Reveal on hover
            clone.querySelector('.dest-url').textContent = rule.destination;
            clone.querySelector('.hit-count-badge').textContent = (rule.hitCount || 0) + ' hits';

            const toggle = clone.querySelector('.rule-enabled');
            toggle.checked = rule.enabled !== false; // Default to true if undefined

            toggle.addEventListener('change', (e) => {
                const updatedRules = [...rules];
                updatedRules[index].enabled = e.target.checked;
                saveRules(updatedRules);
            });

            clone.querySelector('.delete-btn').addEventListener('click', () => {
                if (confirm('Are you sure you want to delete this rule?')) {
                    const updatedRules = rules.filter((_, i) => i !== index);
                    saveRules(updatedRules);
                }
            });

            clone.querySelector('.btn-edit').addEventListener('click', () => {
                // Populate the form with this rule's data
                editingRuleIdInput.value = rule.id;
                ruleTypeInput.value = rule.type;
                if (rule.type === 'bytecode' || rule.type === 'compiled') {
                    ruleSourceCode.value = rule.source;
                    if (ruleBytecodeMatch) ruleBytecodeMatch.value = rule.matchRegex || '';
                    ruleSourceInput.value = '';
                    ruleDestInput.value = '';
                    checkBytecodeWarnings();
                } else {
                    ruleSourceInput.value = rule.source;
                    ruleSourceCode.value = '';
                    if (ruleBytecodeMatch) ruleBytecodeMatch.value = '';
                    ruleDestInput.value = rule.destination || '';
                }

                // Trigger change event to show/hide regex help
                ruleTypeSelect.dispatchEvent(new Event('change'));

                // Change form UI to edit mode
                submitRuleBtn.textContent = 'Save Changes';
                cancelEditBtn.style.display = 'block';

                // Scroll up to form
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });

            if (rule.enabled === false) {
                card.style.opacity = '0.5';
            }

            rulesContainer.appendChild(clone);
        });
    }

    // Handle rule type change
    const ruleTypeSelect = document.getElementById('rule-type');
    const regexHelp = document.getElementById('regex-help');
    const regexDestHelp = document.getElementById('regex-dest-help');
    const wildcardHelp = document.getElementById('wildcard-help');
    const bytecodeHelp = document.getElementById('bytecode-help');

    ruleTypeSelect.addEventListener('change', (e) => {
        const type = e.target.value;
        const isRegex = type === 'regex';
        const isWildcard = type === 'wildcard';
        const isBytecode = type === 'bytecode' || type === 'compiled';

        regexHelp.style.display = isRegex ? 'block' : 'none';
        regexDestHelp.style.display = isRegex ? 'block' : 'none';
        wildcardHelp.style.display = isWildcard ? 'block' : 'none';
        if (bytecodeHelp) bytecodeHelp.style.display = isBytecode ? 'block' : 'none';
        if (debugPanel) debugPanel.style.display = isBytecode ? 'block' : 'none';

        if (isBytecode) {
            ruleSourceInput.style.display = 'none';
            ruleSourceInput.required = false;
            ruleSourceCode.style.display = 'block';
            ruleSourceCode.required = true;

            if (bytecodeMatchGroup) bytecodeMatchGroup.style.display = 'block';

            destGroup.style.display = 'none';
            ruleDestInput.required = false;
            ruleSourceLabel.textContent = type === 'compiled' ? "Compiled VM Script" : "Bytecode Script";
        } else {
            ruleSourceInput.style.display = 'block';
            ruleSourceInput.required = true;
            ruleSourceCode.style.display = 'none';
            ruleSourceCode.required = false;

            if (bytecodeMatchGroup) bytecodeMatchGroup.style.display = 'none';
            if (debugBtnStop && typeof debugBtnStop.click === 'function') debugBtnStop.click();

            destGroup.style.display = 'block';
            ruleDestInput.required = true;
            ruleSourceLabel.textContent = "Source URL / Pattern";
        }
    });

    // Handle cancel edit
    cancelEditBtn.addEventListener('click', () => {
        resetForm();
    });

    function resetForm() {
        form.reset();
        editingRuleIdInput.value = '';
        if (ruleSourceCode) ruleSourceCode.value = '';
        if (ruleBytecodeMatch) ruleBytecodeMatch.value = '';
        if (bytecodeWarning) bytecodeWarning.style.display = 'none';
        submitRuleBtn.textContent = 'Add Rule';
        cancelEditBtn.style.display = 'none';
        ruleTypeSelect.dispatchEvent(new Event('change'));
    }

    // Handle form submission
    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const type = ruleTypeInput.value;
        const isBytecode = type === 'bytecode' || type === 'compiled';
        const source = isBytecode ? ruleSourceCode.value : ruleSourceInput.value;
        const matchRegex = isBytecode && ruleBytecodeMatch ? ruleBytecodeMatch.value : "";
        const destination = isBytecode ? "" : ruleDestInput.value;
        const editingId = editingRuleIdInput.value;

        // Basic validation
        if (!source || (!destination && !isBytecode)) return;

        if (editingId) {
            // Update existing rule
            const ruleIndex = rules.findIndex(r => r.id === editingId);
            if (ruleIndex !== -1) {
                const updatedRules = [...rules];
                updatedRules[ruleIndex] = {
                    ...updatedRules[ruleIndex],
                    type,
                    source,
                    destination
                };
                if (isBytecode && matchRegex) {
                    updatedRules[ruleIndex].matchRegex = matchRegex;
                } else {
                    delete updatedRules[ruleIndex].matchRegex;
                }
                
                if (type === 'compiled') {
                    try {
                        const comp = Compiler.compile(source);
                        updatedRules[ruleIndex].bytecode = comp.bytecode;
                        updatedRules[ruleIndex].constants = comp.constants;
                        updatedRules[ruleIndex].compilerVersion = COMPILER_VERSION;
                    } catch (err) {
                        alert("Compilation Error: " + err.message);
                        return;
                    }
                } else {
                    delete updatedRules[ruleIndex].bytecode;
                    delete updatedRules[ruleIndex].constants;
                }
                
                saveRules(updatedRules).then(() => {
                    resetForm();
                });
            }
        } else {
            // Add new rule
            const newRule = {
                id: generateId(),
                type,
                source,
                destination,
                enabled: true,
                createdAt: Date.now(),
                hitCount: 0
            };
            if (isBytecode && matchRegex) {
                newRule.matchRegex = matchRegex;
            }
            if (type === 'compiled') {
                try {
                    const comp = Compiler.compile(source);
                    newRule.bytecode = comp.bytecode;
                    newRule.constants = comp.constants;
                    newRule.compilerVersion = COMPILER_VERSION;
                } catch (err) {
                    alert("Compilation Error: " + err.message);
                    return;
                }
            }

            const updatedRules = [...rules, newRule];
            saveRules(updatedRules).then(() => {
                resetForm();
            });
        }
    });

    // ===== Encryption helpers (Web Crypto API) =====
    const PBKDF2_ITERATIONS = 10000;

    async function deriveKey(password, salt) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function encryptData(plaintext, password) {
        const enc = new TextEncoder();
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(password, salt);
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            enc.encode(plaintext)
        );
        // Pack salt + iv + ciphertext into a single base64 JSON
        return JSON.stringify({
            s: btoa(String.fromCharCode(...salt)),
            v: btoa(String.fromCharCode(...iv)),
            d: btoa(String.fromCharCode(...new Uint8Array(ciphertext)))
        });
    }

    async function decryptData(encryptedJson, password) {
        const { s, v, d } = JSON.parse(encryptedJson);
        const salt = Uint8Array.from(atob(s), c => c.charCodeAt(0));
        const iv = Uint8Array.from(atob(v), c => c.charCodeAt(0));
        const ciphertext = Uint8Array.from(atob(d), c => c.charCodeAt(0));
        const key = await deriveKey(password, salt);
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext
        );
        return new TextDecoder().decode(decrypted);
    }

    // ===== Password modal helper =====
    const modal = document.getElementById('password-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalDesc = document.getElementById('modal-description');
    const modalPassword = document.getElementById('modal-password');
    const modalConfirm = document.getElementById('modal-confirm-btn');
    const modalCancel = document.getElementById('modal-cancel-btn');

    function promptPassword(title, description) {
        return new Promise((resolve) => {
            modalTitle.textContent = title;
            modalDesc.textContent = description;
            modalPassword.value = '';
            modal.style.display = 'flex';
            modalPassword.focus();

            function cleanup() {
                modal.style.display = 'none';
                modalConfirm.removeEventListener('click', onConfirm);
                modalCancel.removeEventListener('click', onCancel);
                modalPassword.removeEventListener('keydown', onKeydown);
            }
            function onConfirm() {
                const pw = modalPassword.value;
                cleanup();
                resolve(pw || null);
            }
            function onCancel() {
                cleanup();
                resolve(null);
            }
            function onKeydown(e) {
                if (e.key === 'Enter') onConfirm();
                if (e.key === 'Escape') onCancel();
            }
            modalConfirm.addEventListener('click', onConfirm);
            modalCancel.addEventListener('click', onCancel);
            modalPassword.addEventListener('keydown', onKeydown);
        });
    }

    // ===== Export =====
    document.getElementById('export-btn').addEventListener('click', async () => {
        if (rules.length === 0) {
            alert('No rules to export.');
            return;
        }
        const exportData = rules.map(({ id, type, source, destination, enabled, hitCount }) => ({
            type, source, destination, enabled, hitCount: hitCount || 0
        }));
        const jsonStr = JSON.stringify(exportData, null, 2);

        const useEncryption = confirm('Would you like to encrypt the exported rules with a password?');

        if (useEncryption) {
            const password = await promptPassword('Encrypt Export', 'Enter a password to protect your rules. You will need this password to import them later.');
            if (!password) return;

            try {
                const encrypted = await encryptData(jsonStr, password);
                const blob = new Blob([encrypted], { type: 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'redirector-rules.enc';
                a.click();
                URL.revokeObjectURL(url);
            } catch (err) {
                alert('Encryption failed: ' + err.message);
            }
        } else {
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'redirector-rules.json';
            a.click();
            URL.revokeObjectURL(url);
        }
    });

    // ===== Import =====
    const importFileInput = document.getElementById('import-file');
    document.getElementById('import-btn').addEventListener('click', () => {
        importFileInput.click();
    });

    importFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const isEncrypted = file.name.endsWith('.enc');
        const fileText = await file.text();

        let jsonStr;
        if (isEncrypted) {
            const password = await promptPassword('Decrypt Import', 'Enter the password used to encrypt this file.');
            if (!password) {
                importFileInput.value = '';
                return;
            }
            try {
                jsonStr = await decryptData(fileText, password);
            } catch (err) {
                alert('Decryption failed. Wrong password or corrupted file.');
                importFileInput.value = '';
                return;
            }
        } else {
            jsonStr = fileText;
        }

        try {
            const importedRules = JSON.parse(jsonStr);
            if (!Array.isArray(importedRules)) {
                alert('Invalid file format. Expected a JSON array of rules.');
                return;
            }
            const newRules = importedRules.map(r => ({
                id: generateId(),
                type: r.type || 'exact',
                source: r.source || '',
                destination: r.destination || '',
                enabled: r.enabled !== false,
                createdAt: Date.now(),
                hitCount: 0
            }));
            const mergedRules = [...rules, ...newRules];
            saveRules(mergedRules).then(() => {
                alert(`Successfully imported ${newRules.length} rule(s).`);
            });
        } catch (err) {
            alert('Failed to parse the rules: ' + err.message);
        }

        importFileInput.value = '';
    });

    // ===== Pause Logic =====
    const pauseDurationSelect = document.getElementById('pause-duration');
    const pauseBtn = document.getElementById('pause-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const pauseStatus = document.getElementById('pause-status');
    let pauseInterval;

    function formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function checkPauseState() {
        browser.storage.local.get('pauseUntil').then((data) => {
            const pauseUntil = data.pauseUntil || 0;
            const now = Date.now();
            
            clearInterval(pauseInterval);

            if (pauseUntil > now) {
                // Currently paused
                pauseStatus.textContent = `Paused until ${formatTime(pauseUntil)}`;
                pauseStatus.style.display = 'inline';
                resumeBtn.style.display = 'inline-block';
                pauseDurationSelect.style.display = 'none';
                pauseBtn.style.display = 'none';

                // Setup interval to automatically return to normal when time passes
                pauseInterval = setInterval(() => {
                    if (Date.now() > pauseUntil) {
                        checkPauseState();
                    }
                }, 1000);
            } else {
                // Not paused
                if (pauseUntil !== 0) {
                    browser.storage.local.remove('pauseUntil');
                }
                pauseStatus.style.display = 'none';
                resumeBtn.style.display = 'none';
                pauseDurationSelect.style.display = 'inline-block';
                pauseBtn.style.display = 'inline-block';
            }
        });
    }

    pauseBtn.addEventListener('click', () => {
        const minutes = parseInt(pauseDurationSelect.value, 10);
        const pauseUntil = Date.now() + (minutes * 60 * 1000);
        browser.storage.local.set({ pauseUntil }).then(() => {
            checkPauseState();
        });
    });

    resumeBtn.addEventListener('click', () => {
        browser.storage.local.remove('pauseUntil').then(() => {
            checkPauseState();
        });
    });

    browser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.pauseUntil !== undefined) {
            checkPauseState();
        }
    });

    function updateDebugUI() {
        if (!debugSession) return;
        const st = debugSession.state;
        
        debugInstruction.textContent = st._currentInstruction || "-";
        
        const displayData = {};
        if (st.callStack && st.callStack.length > 0) {
             displayData.CallFrames = st.callStack;
        }
        displayData.Stack = st.stack;
        
        debugStack.textContent = JSON.stringify(displayData, null, 2);
        
        if (debugSession.done) {
            debugBtnStep.disabled = true;
            debugBtnRun.disabled = true;
            if (st.error) {
                debugStatus.textContent = "Error: " + st.error;
                debugStatus.style.color = "#ef4444";
            } else if (st.redirectUrl) {
                debugStatus.textContent = "Redirect: " + st.redirectUrl;
                debugStatus.style.color = "#10b981";
            } else {
                debugStatus.textContent = "Halted (Skip)";
                debugStatus.style.color = "#6b7280";
            }
        } else {
            debugStatus.textContent = "Running...";
            debugStatus.style.color = "var(--primary)";
        }
    }

    if (debugBtnStart) {
        debugBtnStart.addEventListener('click', () => {
            const url = debugUrlInput.value || "https://example.com/test";
            const source = ruleSourceCode.value;
            const type = ruleTypeInput.value;
            debugIsCompiled = (type === 'compiled');

            try {
                if (debugIsCompiled) {
                    const comp = Compiler.compile(source);
                    debugSession = VM.createDebugSession(comp.bytecode, comp.constants, url);
                } else {
                    const interpreter = new Interpreter();
                    const lexRes = interpreter.tokenize(source);
                    if (!lexRes.success) throw new Error(lexRes.errors[0].message);
                    debugSession = interpreter.createDebugSession(lexRes.tokens, url);
                }
                
                debugReadout.style.display = 'block';
                debugBtnStep.style.display = 'inline-block';
                debugBtnRun.style.display = 'inline-block';
                debugBtnStop.style.display = 'inline-block';
                debugBtnStart.style.display = 'none';
                
                debugBtnStep.disabled = false;
                debugBtnRun.disabled = false;
                
                updateDebugUI();
            } catch(e) {
                alert("Debug Init Error: " + e.message);
            }
        });

        debugBtnStep.addEventListener('click', () => {
            if (!debugSession || debugSession.done) return;
            if (debugIsCompiled) {
                debugSession = VM.stepSession(debugSession);
            } else {
                const interpreter = new Interpreter();
                debugSession = interpreter.stepSession(debugSession);
            }
            updateDebugUI();
        });

        debugBtnRun.addEventListener('click', () => {
            if (!debugSession || debugSession.done) return;
            const interpreter = new Interpreter();
            while (!debugSession.done) {
                 if (debugIsCompiled) {
                     debugSession = VM.stepSession(debugSession);
                 } else {
                     debugSession = interpreter.stepSession(debugSession);
                 }
            }
            updateDebugUI();
        });

        debugBtnStop.addEventListener('click', () => {
            debugSession = null;
            debugReadout.style.display = 'none';
            debugBtnStep.style.display = 'none';
            debugBtnRun.style.display = 'none';
            debugBtnStop.style.display = 'none';
            debugBtnStart.style.display = 'inline-block';
            debugStatus.textContent = "";
            debugInstruction.textContent = "";
            debugStack.textContent = "";
        });
        
        debugUrlInput.addEventListener('keydown', (e) => {
             if (e.key === 'Enter') {
                 e.preventDefault();
                 if (debugSession && !debugSession.done) {
                     debugBtnStep.click();
                 } else {
                     debugBtnStart.click();
                 }
             }
        });
    }

    // Initial load
    loadRules();
    checkPauseState();
});
