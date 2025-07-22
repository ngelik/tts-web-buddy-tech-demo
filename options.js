import { characters } from './src/characters.js';

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const openrouterApiKeyInput = document.getElementById('openrouterApiKey');
  const openrouterModelInput = document.getElementById('openrouterModel');
  const elevenlabsVoiceIdInput = document.getElementById('elevenlabsVoiceId');
  const saveButton = document.getElementById('save');
  const status = document.getElementById('status');

  // Load saved settings (migrate old key if exists)
  chrome.storage.local.get([
    'ttsbuddy-api-key',
    'TTSBuddy-api-key',
    'openrouter-api-key',
    'openrouter-model',
    'elevenlabs-voice-id',
    'web-buddy-selected-character-id'], (result) => {
    if (result['ttsbuddy-api-key']) {
      apiKeyInput.value = result['ttsbuddy-api-key'];
    } else if (result['TTSBuddy-api-key']) {
      // Migrate old key
      apiKeyInput.value = result['TTSBuddy-api-key'];
      chrome.storage.local.set({ 'ttsbuddy-api-key': result['TTSBuddy-api-key'] }, () => {
        chrome.storage.local.remove('TTSBuddy-api-key');
      });
    }

    if (result['openrouter-api-key']) {
      openrouterApiKeyInput.value = result['openrouter-api-key'];
    }
    if (result['openrouter-model']) {
      openrouterModelInput.value = result['openrouter-model'];
    } else {
      openrouterModelInput.value = 'google/gemma-3n-e4b-it:free'; // Default model
    }
    if (result['elevenlabs-voice-id']) {
      elevenlabsVoiceIdInput.value = result['elevenlabs-voice-id'];
    } else {
      elevenlabsVoiceIdInput.value = 'QkNxCtnKGOHCAoQubo3r'; // Default voice
    }

    // Load saved character and set dropdown
    const savedCharId = result['web-buddy-selected-character-id'] || characters[0].id;
    initializeCharacterDropdown(savedCharId);
  });

  // Character selection logic
  function initializeCharacterDropdown(savedCharId) {
    const characterSelectWrapper = document.getElementById('characterSelectWrapper');
    const characterSelectTrigger = document.getElementById('characterSelectTrigger');
    const characterSelectText = document.getElementById('characterSelectText');
    const characterOptions = document.getElementById('characterOptions');

    if (!characterSelectWrapper || !characterSelectTrigger || !characterSelectText || !characterOptions) {
      console.error('Character dropdown elements not found');
      return;
    }

    if (!characters || characters.length === 0) {
      console.error('Characters array is empty or not loaded');
      // Set a fallback text
      characterSelectText.textContent = 'Default';
      return;
    }

    // Add characters from the data file
    characters.forEach(char => {
      const optionEl = document.createElement('div');
      optionEl.classList.add('custom-option');
      optionEl.textContent = char.title;
      optionEl.dataset.value = char.id;
      characterOptions.appendChild(optionEl);

      optionEl.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent document click listener from firing
        const selectedValue = optionEl.dataset.value;
                
        // Update UI
        if (characterSelectText) {
          characterSelectText.textContent = optionEl.textContent;
          characterSelectText.style.color = '#2d3748'; // Ensure text is visible
          characterSelectText.style.display = 'block'; // Ensure element is visible
        } else {
          console.error('characterSelectText is null in click handler!');
        }
        
        // Update selected classes
        characterOptions.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
        optionEl.classList.add('selected');

        // Save to storage
        chrome.storage.local.set({ 'web-buddy-selected-character-id': selectedValue });

        // Close dropdown
        characterSelectWrapper.classList.remove('open');
      });
    });

    // Set initial selection
    const selectedChar = characters.find(c => c.id === savedCharId) || characters[0];
    
    if (characterSelectText) {
      characterSelectText.textContent = selectedChar.title;
      characterSelectText.style.color = '#2d3748'; // Ensure text is visible
      characterSelectText.style.display = 'block'; // Ensure element is visible
    } else {
      console.error('characterSelectText element is null!');
    }
    
    const selectedOption = characterOptions.querySelector(`.custom-option[data-value="${savedCharId}"]`);
    if (selectedOption) {
      selectedOption.classList.add('selected');
    }

    characterSelectTrigger.addEventListener('click', () => {
      characterSelectWrapper.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!characterSelectWrapper.contains(e.target)) {
        characterSelectWrapper.classList.remove('open');
      }
    });
  }

  // Save settings
  saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const openrouterApiKey = openrouterApiKeyInput.value.trim();
    const openrouterModel = openrouterModelInput.value.trim();
    const elevenlabsVoiceId = elevenlabsVoiceIdInput.value.trim();

    chrome.storage.local.set({
      'ttsbuddy-api-key': apiKey,
      'openrouter-api-key': openrouterApiKey,
      'openrouter-model': openrouterModel,
      'elevenlabs-voice-id': elevenlabsVoiceId
    }, () => {
      status.textContent = 'Settings saved.';
      status.className = 'success';
      setTimeout(() => { status.textContent = ''; status.className = ''; }, 2000);
    });
  });
}); 