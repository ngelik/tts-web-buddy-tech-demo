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
  ], (result) => {
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
  });



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