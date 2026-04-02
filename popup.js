document.addEventListener('DOMContentLoaded', () => {
    // Show extension version
    const versionEl = document.getElementById('app-version');
    if (versionEl) {
        versionEl.textContent = 'v' + browser.runtime.getManifest().version;
    }

    const pauseDurationSelect = document.getElementById('pause-duration');
    const pauseBtn = document.getElementById('pause-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const pauseStatus = document.getElementById('pause-status');
    const pauseTimeRemaining = document.getElementById('pause-time-remaining');
    const pauseControls = document.getElementById('pause-controls');
    const manageRulesBtn = document.getElementById('manage-rules-btn');
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
                pauseStatus.style.display = 'block';
                pauseTimeRemaining.textContent = `Resumes at: ${formatTime(pauseUntil)}`;
                pauseTimeRemaining.style.display = 'block';
                resumeBtn.style.display = 'block';
                pauseControls.style.display = 'none';

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
                pauseTimeRemaining.style.display = 'none';
                resumeBtn.style.display = 'none';
                pauseControls.style.display = 'block';
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

    manageRulesBtn.addEventListener('click', () => {
        browser.runtime.openOptionsPage();
        window.close(); // Close popup
    });

    browser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.pauseUntil !== undefined) {
            checkPauseState();
        }
    });

    // Initial load
    checkPauseState();
});
