import { characters } from './src/characters.js';

// Random greetings for Web Buddy
const webBuddyGreetings = [
  "Hello! Ready to help.",
  "Hi there! I'm listening.",
  "Greetings! How can I assist?",
  "Hello! What would you like to know?",
  "Hi! Ready to chat.",
  "Greetings! I'm here to help.",
  "Hello! What's on your mind?",
  "Hi! How can I clarify?",
  "Hey! I'm all ears.",
  "Good to see you! Ready when you are.",
  "Hello! Let's explore together.",
  "Hi! What shall we discover?",
  "Greetings! I'm your guide.",
  "Hello! Ready to assist.",
  "Hi there! What interests you?",
  "Hey! Let's dive in.",
  "Hello! I'm here for you.",
  "Hi! What can I explain?",
  "Greetings! Ready to help.",
  "Hello! What's your question?",
  "Hi! I'm listening carefully.",
  "Hey! Let's get started.",
  "Hello! How may I help?",
  "Hi there! Ready to explore.",
  "Greetings! What would you like to learn?"
];

// Simplified state for the new workflow
let recordingState = {
  isRecording: false,
  tabId: null,
  targetElement: null, // The content script will manage the target
};

// State for the new analysis workflow
let analysisState = {
  phase: 'idle', // 'idle', 'fetching', 'listening', 'recording', 'processing', 'speaking'
  pageContext: '',
  tabId: null,
  abortController: null,
  audioQueue: [],
  isPlayingAudio: false,
  character: null,
};

// --- Helper Functions ---
function getRandomGreeting() {
  const randomIndex = Math.floor(Math.random() * webBuddyGreetings.length);
  return webBuddyGreetings[randomIndex];
}

// --- Offscreen Document Management ---
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let offscreenDocumentActive = false;

async function hasOffscreenDocument() {
  if (chrome.offscreen?.hasDocument) {
    // Preferred API if available
    return await chrome.offscreen.hasDocument();
  }
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    return contexts.length > 0;
  }
  return offscreenDocumentActive;
}

async function setupOffscreenDocument() {
  if (offscreenDocumentActive || await hasOffscreenDocument()) {
    offscreenDocumentActive = true;
    return;
  }
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Recording audio from the user microphone.',
  });
  offscreenDocumentActive = true;
}

async function closeOffscreenDocument() {
    if (!await hasOffscreenDocument()) return;
    await chrome.offscreen.closeDocument();
    offscreenDocumentActive = false;
}

async function sendToOffscreen(message) {
  if (await hasOffscreenDocument()) chrome.runtime.sendMessage(message);
}

// --- Message Handling ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  let asyncResponse = false;

  switch (request.type) {
    case 'start-recording':
      let startTabId = sender.tab?.id;
      if (!startTabId) {
        (async () => {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTab?.id) handleStartRecording(activeTab.id);
        })();
      } else {
        handleStartRecording(startTabId);
      }
      break;

    case 'recording-started-offscreen':
      if (analysisState.isActive) handleAnalysisRecordingStarted();
      else handleDictationRecordingStarted();
      break;

    case 'permission-denied':
      handlePermissionDenied();
      break;

    case 'stop-recording':
      // The 'stop-recording' message is a signal to stop.
      // We don't need a tabId here, as we'll use the one from when recording started.
      handleStopRecording();
      break;

    case 'audio-blob-ready':
      if (analysisState.phase === 'processing') handleAnalysisAudio(request.dataUrl);
      else handleDictationAudio(request.dataUrl);
      break;

    case 'open-microphone-settings':
      chrome.tabs.create({ url: 'chrome://settings/content/microphone' });
      break;

    case 'COPY_PAGE_MARKDOWN':
      asyncResponse = true;
      (async () => {
          try {
              const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
              if (tabs && tabs.length > 0) {
                  const response = await copyPageAsMarkdown(tabs[0]);
                  if (response && response.success) {
                      sendResponse({ success: true, tokenCount: response.tokenCount });
                  } else {
                      sendResponse({ success: false, error: response?.error || 'Copy failed' });
                  }
              }
          } catch (error) {
              console.error('Error in COPY_PAGE_MARKDOWN:', error);
              sendResponse({ success: false, error: error.message });
          }
      })();
      break;

    case 'GET_ANALYSIS_STATE':
      sendResponse(analysisState);
      break;
    case 'START_ANALYSIS':
      handleStartAnalysis(sendResponse);
      asyncResponse = true;
      break;
    case 'INTERRUPT_ANALYSIS':
      handleInterruptAnalysis(sendResponse);
      break;
    case 'TTS_FINISHED':
      analysisState.isPlayingAudio = false;
      playNextInQueue();
      break;
    case 'STOP_ANALYSIS_RECORDING':
      handleStopAnalysisRecording(sendResponse);
      asyncResponse = true;
      break;
  }
  return asyncResponse;
});

// --- Action Handlers ---

async function handleStartRecording(tabId) {
  if (analysisState.isActive) {
    // Ignore regular dictation when Web Buddy is active
    return;
  }
  recordingState.isRecording = true;
  recordingState.tabId = tabId;
  
  await setupOffscreenDocument();
  sendToOffscreen({ type: 'start-recording' });
}

function handleDictationRecordingStarted() {
  if (!recordingState.tabId) return;
  recordingState.isRecording = true;
  chrome.tabs.sendMessage(recordingState.tabId, { type: 'recording-started' });
}

function handleAnalysisRecordingStarted() {
  if (!analysisState.tabId) return;
  analysisState.isRecording = true;
}

async function handlePermissionDenied() {
  if (!recordingState.tabId) return;
  const message = 'Microphone access is not available. Please complete the extension setup by clicking the extension icon and going through the onboarding process.';
  chrome.tabs.sendMessage(recordingState.tabId, { type: 'error', message: message });
  
  recordingState.isRecording = false;
  recordingState.tabId = null;
  await closeOffscreenDocument();
}

async function handleStopRecording() {
  if (!recordingState.isRecording) {
    return;
  }
  recordingState.isRecording = false; // Stop recording immediately from a state perspective.
  
  sendToOffscreen({ type: 'stop-recording' }); // Send to offscreen
  
  // Notify the content script that we are now processing
  if (recordingState.tabId) {
    chrome.tabs.sendMessage(recordingState.tabId, { type: 'processing-started' });
  }
}

async function handleDictationAudio(dataUrl) {
  const currentTabId = recordingState.tabId;
  recordingState.tabId = null; // Reset for next time.

  // This is a one-off dictation, so we can close the offscreen document.
  await closeOffscreenDocument();
  
  const storageResult = await chrome.storage.local.get(['ttsbuddy-api-key']);
  const apiKey = storageResult['ttsbuddy-api-key'];

  if (!currentTabId) {
      console.error("No tab ID found for transcription result.");
      return;
  }
  
  if (!apiKey) {
      chrome.tabs.sendMessage(currentTabId, { type: 'error', message: 'API key not set. Please set it in the options page.' });
      chrome.runtime.openOptionsPage();
      return;
  }
  
  try {
    const fetchRes = await fetch(dataUrl);
    const blob = await fetchRes.blob();

    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');
    formData.append('model_id', 'scribe_v1');

    const apiResponse = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: formData,
    });

    if (!apiResponse.ok) throw new Error(`API Error: ${apiResponse.status} ${await apiResponse.text()}`);

    const result = await apiResponse.json();
    await chrome.tabs.sendMessage(currentTabId, {
      type: 'insert-text',
      text: result.text,
    });
  } catch (error) {
    console.error('Error during transcription:', error);
    chrome.tabs.sendMessage(currentTabId, { type: 'error', message: `Error: ${error.message}` });
  }
}

// --- Analysis Workflow Handlers ---
async function handleStartAnalysis(sendResponse) {
  if (analysisState.abortController) {
    analysisState.abortController.abort('New analysis started');
    sendToOffscreen({ type: 'STOP_AUDIO' });
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const { 'web-buddy-selected-character-id': selectedCharId } = await chrome.storage.local.get('web-buddy-selected-character-id');
  const selectedCharacter = characters.find(c => c.id === selectedCharId) || characters[0];

  const abortController = new AbortController();
  analysisState = { 
    phase: 'fetching',
    pageContext: '',
    tabId: tab.id,
    abortController: abortController,
    audioQueue: [],
    isPlayingAudio: false,
    character: selectedCharacter
  };

  sendResponse(analysisState); // Update popup UI to "Fetching..."

  try {
    const md = await getPageMarkdownForAnalysis(tab);
    analysisState.pageContext = md;
    
    // Get API keys for greeting
    const { 'elevenlabs-api-key': elevenApi, 'openrouter-api-key': orApi, 'openrouter-model': orModel } = await chrome.storage.local.get(['elevenlabs-api-key', 'openrouter-api-key', 'openrouter-model']);
    
    if (!elevenApi) {
      console.error('ElevenLabs API key not found');
      resetAnalysisState();
      chrome.runtime.sendMessage({ type: 'ANALYSIS_STATE_UPDATE', state: analysisState });
      return;
    }

    // Play a greeting first
    const greeting = getRandomGreeting();
    const voiceId = analysisState.character?.voiceId || '1SM7GgM6IMuvQlz2BwM3'; // Default voice
    
    // Set phase to speaking for the greeting
    analysisState.phase = 'speaking';
    chrome.runtime.sendMessage({ type: 'ANALYSIS_STATE_UPDATE', state: analysisState });
    
    // Setup offscreen and play greeting
    await setupOffscreenDocument();
    
    try {
      // Generate and play the greeting
      const greetingAudio = await generateAudioForSentence(greeting, elevenApi, voiceId);
      if (greetingAudio) {
        sendToOffscreen({ type: 'PLAY_AUDIO', dataUrl: greetingAudio });
        
        // Wait for greeting to finish, then start recording
        setTimeout(() => {
          analysisState.phase = 'recording';
          chrome.runtime.sendMessage({ type: 'ANALYSIS_STATE_UPDATE', state: analysisState });
          
          sendToOffscreen({ type: 'PLAY_BEEP', isStart: true });
          sendToOffscreen({ type: 'start-recording' });
        }, 1500); // Wait 1.5 seconds for shorter greeting to finish
      } else {
        // If greeting fails, start recording immediately
        analysisState.phase = 'recording';
        chrome.runtime.sendMessage({ type: 'ANALYSIS_STATE_UPDATE', state: analysisState });
        
        sendToOffscreen({ type: 'PLAY_BEEP', isStart: true });
        sendToOffscreen({ type: 'start-recording' });
      }
    } catch (error) {
      console.error('Greeting generation failed:', error);
      // If greeting fails, start recording immediately
      analysisState.phase = 'recording';
      chrome.runtime.sendMessage({ type: 'ANALYSIS_STATE_UPDATE', state: analysisState });
      
      sendToOffscreen({ type: 'PLAY_BEEP', isStart: true });
      sendToOffscreen({ type: 'start-recording' });
    }

  } catch (error) {
    console.error("Analysis startup failed:", error);
    resetAnalysisState();
    // Send a new message to all parts of the extension (including popup)
    chrome.runtime.sendMessage({ type: 'ANALYSIS_STATE_UPDATE', state: analysisState });
  }
}



async function handleStopAnalysisRecording(sendResponse) {
  if (analysisState.phase !== 'recording') return;
  analysisState.phase = 'processing';
  sendResponse(analysisState); // Update popup UI to "Processing..."

  await setupOffscreenDocument(); // Ensure it's active
  sendToOffscreen({ type: 'PLAY_BEEP', isStart: false });
  sendToOffscreen({ type: 'stop-recording' });
}

function handleInterruptAnalysis(sendResponse) {
  if (analysisState.abortController) {
    analysisState.abortController.abort('User interrupted');
  }
  sendToOffscreen({ type: 'STOP_AUDIO' });
  resetAnalysisState();
  sendResponse(analysisState); // Send back the new, clean state
}

function resetAnalysisState() {
  analysisState = {
    phase: 'idle',
    pageContext: '',
    tabId: null,
    abortController: null,
    audioQueue: [],
    isPlayingAudio: false,
    character: characters[0],
  };
  closeOffscreenDocument();
}

async function transcribeUserAudio(dataUrl, apiKey) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const formData = new FormData();
  formData.append('file', blob, 'recording.webm');
  formData.append('model_id', 'scribe_v1');

  const sttRes = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: formData,
    signal: analysisState.abortController?.signal,
  });
  if (!sttRes.ok) throw new Error(`STT API Error: ${sttRes.status}`);
  const sttJson = await sttRes.json();
  return sttJson.text;
}

async function handleAnalysisAudio(dataUrl) {
  const {
    'ttsbuddy-api-key': elevenApi,
    'openrouter-api-key': orApi,
    'openrouter-model': orModel,
    'elevenlabs-voice-id': defaultVoiceId,
  } = await chrome.storage.local.get(['ttsbuddy-api-key','openrouter-api-key','openrouter-model','elevenlabs-voice-id']);

  const voiceIdToUse = analysisState.character?.voiceId || defaultVoiceId;

  const tabId = analysisState.tabId;
  if (!elevenApi || !orApi || !orModel || !voiceIdToUse) {
    if (tabId) chrome.tabs.sendMessage(tabId, { type: 'error', message: 'API keys/model/voice missing, set them in options.'});
    chrome.runtime.openOptionsPage();
    resetAnalysisState();
    return;
  }

  try {
    if (analysisState.phase !== 'processing') return; // Check if still relevant
    const question = await transcribeUserAudio(dataUrl, elevenApi);
    if (!question) throw new Error('Empty transcription');

    await streamLlmToTts(question, orApi, orModel, elevenApi, voiceIdToUse);
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('Analysis error:', e);
      if (tabId) chrome.tabs.sendMessage(tabId,{type:'error',message:`Analysis Error: ${e.message}`});
    }
    resetAnalysisState();
  }
}

function queueTtsForSentence(sentence, apiKey, voiceId) {
  const p = generateAudioForSentence(sentence, apiKey, voiceId);
  analysisState.audioQueue.push(p);
  playNextInQueue();
}

async function generateAudioForSentence(sentence, apiKey, voiceId) {
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'accept': 'audio/mpeg'
    },
    body: JSON.stringify({ text: sentence, model_id: 'eleven_turbo_v2_5' }),
    signal: analysisState.abortController.signal,
  });
  if (!resp.ok) throw new Error(`TTS Stream Error: ${resp.status}`);
  return await resp.blob();
}

async function playNextInQueue() {
  if (analysisState.isPlayingAudio || analysisState.audioQueue.length === 0) {
    return;
  }

  analysisState.isPlayingAudio = true;
  const audioPromise = analysisState.audioQueue.shift();
  try {
    const audioBlob = await audioPromise;
    if (audioBlob === null) { // Sentinel value marks the end
      analysisState.isPlayingAudio = false;
      if (analysisState.audioQueue.length === 0) {
          analysisState.phase = 'listening'; // Go back to listening for follow-up
          // No reset, keep context. Offscreen doc stays open.
          chrome.runtime.sendMessage({type: 'ANALYSIS_STATE_UPDATE', state: analysisState });
      }
      return;
    }

    const audioDataUrl = await new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(audioBlob);
    });
    sendToOffscreen({ type: 'PLAY_AUDIO', dataUrl: audioDataUrl });
  } catch (e) {
    if (e.name !== 'AbortError') console.error('Audio queue error:', e);
    analysisState.isPlayingAudio = false;
    resetAnalysisState();
  }
}

async function streamLlmToTts(question, orApi, orModel, elevenApi, voiceId) {
  const systemPrompt = analysisState.character?.prompt || `You are an expert analyst. You will be given the content of a webpage in Markdown format. Your task is to analyze it and provide a concise, helpful answer to the user's question that follows the content.`;

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${orApi}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/tts-buddy/tts-buddy-chrome-ext',
      'X-Title': 'Web Buddy',
    },
    body: JSON.stringify({
      model: orModel,
      stream: true,
      messages: [
        { 
          role: 'user', 
          content: `${systemPrompt}\n\nWebpage Content:\n\n---\n\n${analysisState.pageContext}\n\nMy question: ${question}` 
        }
      ]
    }),
    signal: analysisState.abortController.signal,
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    console.error("OpenRouter API Error Response:", errorBody);
    throw new Error(`OpenRouter stream error: ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) queueTtsForSentence(buffer.trim(), elevenApi, voiceId);
      analysisState.audioQueue.push(Promise.resolve(null));
      playNextInQueue();
      break;
    }
    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.substring(6);
      if (data.trim() === '[DONE]') {
        continue;
      }
      try {
        const json = JSON.parse(data);
        const delta = json.choices[0]?.delta?.content;
        if (delta) {
          buffer += delta;
          const re = /[.!?\n]/;
          let m;
          while ((m = buffer.match(re))) {
            const sentence = buffer.substring(0, m.index + 1).trim();
            buffer = buffer.substring(m.index + 1);
            if (sentence) queueTtsForSentence(sentence, elevenApi, voiceId);
          }
        }
      } catch {}
    }
  }
}


// --- Lifecycle ---
chrome.runtime.onStartup.addListener(() => {
    recordingState = { isRecording: false, tabId: null };
    offscreenDocumentActive = false;
});

// Open onboarding page when extension is installed
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        // Open onboarding page on first install
        chrome.tabs.create({ url: 'onboarding.html' });
        offscreenDocumentActive = false;
    } else if (details.reason === 'update') {
        // Check if onboarding was completed before
        const result = await chrome.storage.local.get('onboarding-complete');
        if (!result['onboarding-complete']) {
            // Open onboarding if it wasn't completed before
            chrome.tabs.create({ url: 'onboarding.html' });
        }
        offscreenDocumentActive = false;
    }
});

async function copyPageAsMarkdown(tab) {
  try {
    const result = await getPageMarkdown(tab);
    
    // If getPageMarkdown returned a response object (e.g., for YouTube videos)
    if (result && typeof result === 'object' && 'success' in result) {
      return result;
    }
    
    // Otherwise, result should be markdown text
    const markdown = result;
    
    // Check if we got valid markdown content
    if (!markdown || markdown.trim() === '') {
      return { success: false, error: 'No content found on this page' };
    }
    
    // Send message to content script to handle clipboard copy
    const response = await chrome.tabs.sendMessage(tab.id, { 
      type: 'COPY_TO_CLIPBOARD', 
      text: markdown 
    });
    return response;
  } catch (err) {
    // If content script isn't loaded, inject it first
    if (err.message?.includes('Receiving end does not exist')) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-script.js'],
        });
        
        // Get the markdown again after injecting the script
        const result = await getPageMarkdown(tab);
        if (result && typeof result === 'object' && 'success' in result) {
          return result;
        }
        
        const markdown = result;
        if (!markdown || markdown.trim() === '') {
          return { success: false, error: 'No content found on this page' };
        }
        
        const response = await chrome.tabs.sendMessage(tab.id, { 
          type: 'COPY_TO_CLIPBOARD', 
          text: markdown 
        });
        return response;
      } catch (injectErr) {
        console.error('Failed to copy even after injecting script:', injectErr);
        return { success: false, error: `Failed to copy content: ${injectErr.message}` };
      }
    } else {
      console.error('Error in copyPageAsMarkdown:', err);
      return { success: false, error: `Copy failed: ${err.message}` };
    }
  }
}

async function getPageMarkdown(tab) {
    let markdownContent = '';
    try {
        // Ensure we don't try to inject into protected pages
        if (!tab.id) {
            throw new Error("Active tab has no ID");
        }
        const url = tab.url;

        if (!url || url.startsWith('chrome:') || url.startsWith('about:')) {
            throw new Error(`Cannot get content from restricted URL: ${url}`);
        }

        // Special handling for YouTube subtitles, as it's a common use case
        // This part remains unchanged but will now be part of getting markdown, not copying directly
        if (url && url.includes('youtube.com/watch')) {
            try {
                const videoIdMatch = url.match(/[?&]v=([^&]+)/);
                const videoId = videoIdMatch ? videoIdMatch[1] : null;

                if (videoId) {
                    const response = await chrome.tabs.sendMessage(tab.id, {
                        type: 'COPY_YOUTUBE_SUBTITLE',
                        payload: videoId
                    });
                    // Return the response from the content script
                    if (response && response.success) {
                        return response; // This will be handled by copyPageAsMarkdown
                    } else {
                        throw new Error(response?.error || 'Failed to copy YouTube subtitles');
                    }
                }
            } catch (error) {
                console.error('Error handling YouTube subtitle:', error);
                // Continue to try body copy
            }
        }

        // Execute a script in the tab to get the body content (cpdown approach)
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                // This is the same function from cpdown to get the main content
                return document.body.outerHTML;
            }
        });

        // The result is an array of execution results
        if (results && results.length > 0 && results[0].result) {
            const bodyContent = results[0].result;

            // Send the HTML content to content script for processing
            let response;
            try {
                // Request markdown from content script instead of asking it to copy
                response = await chrome.tabs.sendMessage(tab.id, {
                    type: 'GET_MARKDOWN',
                    payload: bodyContent
                });
            } catch (err) {
                // This error typically means the content script isn't loaded yet.
                if (err.message?.includes('Receiving end does not exist')) {
                    try {
                        await chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            files: ['content-script.js'],
                        });
                        response = await chrome.tabs.sendMessage(tab.id, {
                            type: 'GET_MARKDOWN',
                            payload: bodyContent
                        });
                    } catch (injectErr) {
                        console.error('Failed to get markdown even after injecting script:', injectErr);
                        throw new Error(`Failed to load content script: ${injectErr.message}`);
                    }
                } else {
                    throw err; // Re-throw other errors
                }
            }
            
            if (response && response.success) {
                markdownContent = response.markdown;
            } else {
                console.error('Content script reported failure:', response?.error);
                throw new Error(response?.error || 'Content script failed to get markdown');
            }
        } else {
            throw new Error('No body HTML received from executeScript');
        }
    } catch (error) {
        console.error('Error getting page markdown:', error);
        throw error; // Re-throw the error so the calling function can handle it
    }
    return markdownContent;
}

async function getPageMarkdownForAnalysis(tab) {
    let markdownContent = '';
    try {
        // Ensure we don't try to inject into protected pages
        if (!tab.id) {
            throw new Error("Active tab has no ID");
        }
        const url = tab.url;

        if (!url || url.startsWith('chrome:') || url.startsWith('about:')) {
            throw new Error(`Cannot get content from restricted URL: ${url}`);
        }

        // Special handling for YouTube subtitles for analysis
        if (url && url.includes('youtube.com/watch')) {
            try {
                const videoIdMatch = url.match(/[?&]v=([^&]+)/);
                const videoId = videoIdMatch ? videoIdMatch[1] : null;

                if (videoId) {
                    // Get video title from page
                    const titleResults = await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: () => {
                            return (
                                document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent ||
                                document.querySelector('#title')?.textContent ||
                                document.querySelector('title')?.textContent ||
                                'YouTube Video'
                            ).trim();
                        }
                    });
                    
                    const title = titleResults && titleResults.length > 0 ? titleResults[0].result : 'YouTube Video';
                    
                    // Get subtitles
                    const response = await chrome.tabs.sendMessage(tab.id, {
                        type: 'GET_YOUTUBE_SUBTITLE_FOR_ANALYSIS',
                        payload: videoId
                    });
                    
                    if (response && response.success && response.markdown) {
                        return response.markdown;
                    } else {
                        console.warn('Failed to get YouTube subtitles, trying to get video description and comments');
                        
                        // Fallback: get video description and comments
                        const fallbackResults = await chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            func: () => {
                                const description = document.querySelector('#description-text')?.textContent?.trim() || '';
                                const comments = Array.from(document.querySelectorAll('#content-text')).map(el => el.textContent.trim()).filter(text => text).join('\n\n');
                                
                                let content = `# ${document.title}\n\n`;
                                if (description) {
                                    content += `## Description\n\n${description}\n\n`;
                                }
                                if (comments) {
                                    content += `## Comments\n\n${comments}\n\n`;
                                }
                                
                                return content || null;
                            }
                        });
                        
                        if (fallbackResults && fallbackResults.length > 0 && fallbackResults[0].result) {
                            return fallbackResults[0].result;
                        }
                        
                        console.warn('No fallback content available, continuing to body content extraction');
                    }
                }
            } catch (error) {
                console.error('Error handling YouTube subtitle for analysis:', error);
                // Continue to try body copy
            }
        }

        // Execute a script in the tab to get the body content (cpdown approach)
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                // This is the same function from cpdown to get the main content
                return document.body.outerHTML;
            }
        });

        // The result is an array of execution results
        if (results && results.length > 0 && results[0].result) {
            const bodyContent = results[0].result;

            // Send the HTML content to content script for processing
            let response;
            try {
                // Request markdown from content script instead of asking it to copy
                response = await chrome.tabs.sendMessage(tab.id, {
                    type: 'GET_MARKDOWN',
                    payload: bodyContent
                });
            } catch (err) {
                // This error typically means the content script isn't loaded yet.
                if (err.message?.includes('Receiving end does not exist')) {
                    try {
                        await chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            files: ['content-script.js'],
                        });
                        response = await chrome.tabs.sendMessage(tab.id, {
                            type: 'GET_MARKDOWN',
                            payload: bodyContent
                        });
                    } catch (injectErr) {
                        console.error('Failed to get markdown even after injecting script:', injectErr);
                        throw new Error(`Failed to load content script: ${injectErr.message}`);
                    }
                } else {
                    throw err; // Re-throw other errors
                }
            }
            
            if (response && response.success) {
                markdownContent = response.markdown;
            } else {
                console.error('Content script reported failure:', response?.error);
                throw new Error(response?.error || 'Content script failed to get markdown');
            }
        } else {
            throw new Error('No body HTML received from executeScript');
        }
    } catch (error) {
        console.error('Error getting page markdown for analysis:', error);
        throw error; // Re-throw the error so the calling function can handle it
    }
    return markdownContent;
}
