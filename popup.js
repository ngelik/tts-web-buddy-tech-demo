import { characters } from './src/characters.js';

document.addEventListener('DOMContentLoaded', () => {
  // Site toggle logic
  const toggle = document.getElementById('siteToggle');
  const copyBtn = document.getElementById('copyBtn');
  const webBuddyBtn = document.getElementById('webBuddyBtn');
  const statusEl = document.getElementById('status');
  const characterSelect = document.getElementById('characterSelect');

  if (toggle && statusEl) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if(!tabs.length) return;
      const url = new URL(tabs[0].url);
      const hostname = url.hostname;

      chrome.storage.local.get(['ttsbuddy-disabled-hosts'], (result) => {
        const disabledHosts = result['ttsbuddy-disabled-hosts'] || [];
        const isDisabled = disabledHosts.includes(hostname);
        toggle.checked = !isDisabled;
      });

      toggle.addEventListener('change', () => {
        
        chrome.storage.local.get(['ttsbuddy-disabled-hosts'], (result) => {
          const disabledHosts = result['ttsbuddy-disabled-hosts'] || [];
          
          if (toggle.checked) {
            // Enable: remove from disabled list
            const newDisabledHosts = disabledHosts.filter(h => h !== hostname);
            chrome.storage.local.set({ 'ttsbuddy-disabled-hosts': newDisabledHosts });
          } else {
            // Disable: add to disabled list
            if (!disabledHosts.includes(hostname)) {
              disabledHosts.push(hostname);
              chrome.storage.local.set({ 'ttsbuddy-disabled-hosts': disabledHosts });
            }
          }
        });
      });
    });
  }

  // Copy Page button logic
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      statusEl.textContent = 'Copying page...';
      
      chrome.runtime.sendMessage({ type: 'COPY_PAGE_MARKDOWN' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Runtime error:', chrome.runtime.lastError.message || chrome.runtime.lastError);
          statusEl.textContent = 'Error: ' + (chrome.runtime.lastError.message || 'Unknown error');
          return;
        }
        
        if (response && response.success) {
          statusEl.textContent = `Copied! (${response.tokenCount} tokens)`;
        } else {
          statusEl.textContent = 'Copy failed. See console.';
          console.error('Copy failed:', response?.error || 'Unknown error');
        }
      });
    });
  }

  // "Web Buddy" button logic
  function updateWebBuddyButton(state) {
    const phase = state?.phase || 'idle';
    webBuddyBtn.classList.remove('is-recording', 'is-processing', 'is-listening');
    webBuddyBtn.disabled = false;

    switch(phase) {
      case 'fetching':
        webBuddyBtn.textContent = 'Reading Page...';
        webBuddyBtn.disabled = true;
        webBuddyBtn.classList.add('is-processing');
        statusEl.textContent = 'Please wait...';
        break;
      case 'recording':
        webBuddyBtn.textContent = 'Stop Recording';
        webBuddyBtn.classList.add('is-recording');
        statusEl.textContent = 'Recording your question...';
        break;
      case 'processing':
      case 'speaking':
        webBuddyBtn.textContent = 'Interrupt';
        webBuddyBtn.classList.add('is-processing');
        statusEl.textContent = phase === 'processing' ? 'Thinking...' : 'Speaking...';
        break;
      case 'idle':
      default:
        webBuddyBtn.textContent = 'Web Buddy';
        statusEl.textContent = 'Your web-aware audio assistant';
        break;
    }
  }
  
  chrome.runtime.onMessage.addListener((request) => {
    if (request.type === 'ANALYSIS_STATE_UPDATE') {
      updateWebBuddyButton(request.state);
    }
  });

  if (webBuddyBtn) {
    chrome.runtime.sendMessage({ type: 'GET_ANALYSIS_STATE' }, updateWebBuddyButton);

    webBuddyBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'GET_ANALYSIS_STATE' }, (state) => {
        const phase = state?.phase || 'idle';
        let messageType;
        switch(phase) {
          case 'idle':
            messageType = 'START_ANALYSIS';
            break;
          case 'recording':
            messageType = 'STOP_ANALYSIS_RECORDING';
            break;
          case 'processing':
          case 'speaking':
            messageType = 'INTERRUPT_ANALYSIS';
            break;
        }
        if (messageType) {
          chrome.runtime.sendMessage({ type: messageType }, updateWebBuddyButton);
        }
      });
    });
  }

  // "Web Buddy" persona selection logic
  if (characterSelect) {
    // Add characters from the data file
    characters.forEach(char => {
      const option = document.createElement('option');
      option.value = char.id;
      option.textContent = char.title;
      characterSelect.appendChild(option);
    });

    // Load saved character and set dropdown
    chrome.storage.local.get(['web-buddy-selected-character-id'], (result) => {
      const savedCharId = result['web-buddy-selected-character-id'] || characters[0].id;
      characterSelect.value = savedCharId;
    });

    // Save character on change
    characterSelect.addEventListener('change', () => {
      chrome.storage.local.set({ 'web-buddy-selected-character-id': characterSelect.value });
    });
  }
}); 