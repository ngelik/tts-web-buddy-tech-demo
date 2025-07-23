import { characters } from './src/characters.js';

document.addEventListener('DOMContentLoaded', () => {
  // Site toggle logic
  const toggle = document.getElementById('siteToggle');
  const copyBtn = document.getElementById('copyBtn');
  const webBuddyBtn = document.getElementById('webBuddyBtn');
  const statusEl = document.getElementById('status');

  if (toggle && statusEl) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if(!tabs.length) return;
      const url = new URL(tabs[0].url);
      const hostname = url.hostname;

      chrome.storage.local.get(['ttsbuddy-enabled-hosts'], (result) => {
        const enabledHosts = result['ttsbuddy-enabled-hosts'] || [];
        const isEnabled = enabledHosts.includes(hostname);
        toggle.checked = isEnabled; // Checked = enabled, unchecked = disabled
      });

      toggle.addEventListener('change', () => {
        
        chrome.storage.local.get(['ttsbuddy-enabled-hosts'], (result) => {
          const enabledHosts = result['ttsbuddy-enabled-hosts'] || [];
          
          if (toggle.checked) {
            // Enable: add to enabled list
            if (!enabledHosts.includes(hostname)) {
              enabledHosts.push(hostname);
              chrome.storage.local.set({ 'ttsbuddy-enabled-hosts': enabledHosts });
            }
          } else {
            // Disable: remove from enabled list
            const newEnabledHosts = enabledHosts.filter(h => h !== hostname);
            chrome.storage.local.set({ 'ttsbuddy-enabled-hosts': newEnabledHosts });
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

  // Character selection logic
  function setupCharacterButtons() {
    const characterContainer = document.querySelector('.character-selector');
    if (!characterContainer) return;

    // Filter out the 'default' character
    const selectableCharacters = characters.filter(c => c.id !== 'default');

    selectableCharacters.forEach(char => {
      const btn = document.createElement('button');
      btn.className = 'char-btn';
      btn.dataset.charId = char.id;
      btn.title = char.title; // for tooltip
      
      let icon = '';
      switch(char.id) {
          case 'mood-sensitive-reader': icon = '📖'; break;
          case 'vocal-navigation-companion': icon = '🎤'; break;
          case 'cognitive-load-reducer': icon = '💡'; break;
          case 'multilingual-clarity-assistant': icon = '🌐'; break;
          case 'social-cue-interpreter': icon = '🤔'; break;
          case 'humorous-parody': icon = '😂'; break;
      }
      btn.innerHTML = icon;

      btn.addEventListener('click', () => {
        document.querySelectorAll('.char-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        chrome.storage.local.set({ 'web-buddy-selected-character-id': char.id });
      });

      characterContainer.appendChild(btn);
    });

    // Load saved character and set active button
    chrome.storage.local.get(['web-buddy-selected-character-id'], (result) => {
      const savedCharId = result['web-buddy-selected-character-id'];
      const activeBtn = savedCharId ? document.querySelector(`.char-btn[data-char-id="${savedCharId}"]`) : null;
      
      if (activeBtn) {
        activeBtn.classList.add('selected');
      } else {
        // if no saved id or button not found, select the first one and save it
        const firstBtn = document.querySelector('.char-btn');
        if (firstBtn) {
          firstBtn.classList.add('selected');
          chrome.storage.local.set({ 'web-buddy-selected-character-id': firstBtn.dataset.charId });
        }
      }
    });
  }

  setupCharacterButtons();

}); 