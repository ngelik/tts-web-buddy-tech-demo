// Load external libraries
let libsLoaded = false;
let Turndown, Readability, Defuddle, Tiktoken, o200k_base, tiktoken;

async function loadLibraries() {
    if (libsLoaded) return;
    try {
        // Dynamically import the bundled ES module to get access within the isolated world
        const module = await import(chrome.runtime.getURL('dist/libs-bundle.js'));
        ({ Turndown, Readability, Defuddle, Tiktoken, o200k_base } = module);
        if (o200k_base && Tiktoken) tiktoken = new Tiktoken(o200k_base);
        libsLoaded = true;
    } catch (error) {
        console.error('Failed to dynamically import markdown libraries:', error);
        libsLoaded = false;
        throw error;
    }
}

// Load libraries immediately and wait for completion
(async () => {
    await loadLibraries();
})();

let activeElement = null;
let micButton = null;
let micIcon = null;
let micState = 'idle'; // idle, recording, processing
let audioCtx = null;
let spinnerEl = null;
let processingTimeoutId = null;
let oopsEl = null;

// add globals
let caretStart=null, caretEnd=null, savedRange=null;

// globals
let recordingTarget=null;

// Toast banner for non-blocking error messages
function showToast(message, duration = 3000, type = 'error') {
    const containerId = 'ttsbuddy-toast-container';
    let container = document.getElementById(containerId);
    if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        Object.assign(container.style, {
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2147483647,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            alignItems: 'center',
            pointerEvents: 'none'
        });
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.textContent = message;
    
    // Set background color based on type
    const backgroundColor = type === 'success' 
        ? 'rgba(34,197,94,0.95)' // Green for success
        : 'rgba(220,53,69,0.95)'; // Red for error (default)
    
    Object.assign(toast.style, {
        background: backgroundColor,
        color: '#fff',
        padding: '8px 16px',
        borderRadius: '4px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        fontSize: '14px',
        opacity: '1',
        transition: 'opacity 0.3s',
        pointerEvents: 'auto'
    });

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

const MIC_ICON_URL = chrome.runtime.getURL('icons/mic.png');
const RECORDING_ICON_URL = chrome.runtime.getURL('icons/mic-recording.png');
const PROCESSING_ICON_URL = chrome.runtime.getURL('icons/mic-processing.png');

// --- Per-site enable/disable ---
let siteEnabled = true;

function updateSiteEnabledState() {
  chrome.storage.local.get(['ttsbuddy-enabled-hosts'], (res) => {
    const list = res['ttsbuddy-enabled-hosts'] || [];
    const wasEnabled = siteEnabled;
    siteEnabled = list.includes(window.location.hostname); // Only enabled if explicitly in list
    
    
    if (wasEnabled && !siteEnabled) {
      console.log('Web Buddy disabled on this site');
      hideMicButton();
    } else if (!wasEnabled && siteEnabled) {
      console.log('Web Buddy enabled on this site');
      // Show mic button if there's an active element
      if (activeElement && isEditable(activeElement)) {
        positionMicButton(activeElement);
      }
    }
  });
}

// Initialize state
updateSiteEnabledState();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['ttsbuddy-enabled-hosts']) {
    updateSiteEnabledState();
  }
});

function playBeep(isStart) {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.error("VTT: Could not create AudioContext.", e);
            return;
        }
    }
    // It's possible the context is suspended, resume it.
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    gainNode.gain.value = 0.1; // Low volume
    oscillator.frequency.value = isStart ? 880 : 440; // A5 for start, A4 for stop
    oscillator.type = 'sine';

    oscillator.start();
    setTimeout(() => {
        oscillator.stop();
    }, 100); // Beep duration
}

function createMicButton() {
    const button = document.createElement('button');
    button.id = 'vtt-mic-button';
    button.style.position = 'absolute';
    button.style.zIndex = '99999';
    button.style.width = '32px';
    button.style.height = '32px';
    button.style.border = 'none';
    button.style.padding = '0';
    button.style.cursor = 'pointer';
    button.style.backgroundColor = 'transparent'; // no visible square
    button.style.borderRadius = '0';
    button.style.boxShadow = 'none';
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.transition = 'transform 0.1s ease';

    micIcon = document.createElement('img');
    micIcon.src = MIC_ICON_URL;
    micIcon.style.width = '28px';
    micIcon.style.height = '28px';
    button.appendChild(micIcon);

    button.addEventListener('click', handleMicClick);
    button.addEventListener('mouseover', () => { button.style.transform = 'scale(1.1)'; });
    button.addEventListener('mouseout', () => { button.style.transform = 'scale(1.0)'; });

    document.body.appendChild(button);
    return button;
}

function createSpinner() {
  const spinner = document.createElement('div');
  spinner.style.width = '18px';
  spinner.style.height = '18px';
  spinner.style.border = '2px solid rgba(59,130,246,0.3)';
  spinner.style.borderTop = '2px solid #3B82F6';
  spinner.style.borderRadius = '50%';
  spinner.style.animation = 'vtt-spin 1s linear infinite';
  spinner.style.position = 'absolute';
  spinner.style.top = '50%';
  spinner.style.left = '50%';
  spinner.style.transform = 'translate(-50%, -50%)';
  return spinner;
}

// inject keyframes once
const styleTag = document.createElement('style');
styleTag.textContent = `@keyframes vtt-spin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}`;
document.head.appendChild(styleTag);

function showOops() {
  if (!micButton) return;
  if (!oopsEl) {
    oopsEl = document.createElement('div');
    oopsEl.textContent = 'Oops';
    oopsEl.style.position = 'absolute';
    oopsEl.style.background = '#f87171';
    oopsEl.style.color = '#fff';
    oopsEl.style.fontSize = '12px';
    oopsEl.style.padding = '2px 6px';
    oopsEl.style.borderRadius = '4px';
    oopsEl.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
    document.body.appendChild(oopsEl);
  }
  const rect = micButton.getBoundingClientRect();
  oopsEl.style.top = `${window.scrollY + rect.top - 24}px`;
  oopsEl.style.left = `${window.scrollX + rect.left}px`;
  oopsEl.style.opacity = '1';
  setTimeout(() => { if (oopsEl) oopsEl.style.opacity = '0'; }, 3000);
}

function showSpinner() {
  if (!micButton) return;
  if (!spinnerEl) {
    spinnerEl = createSpinner();
    micButton.appendChild(spinnerEl);
  }
  spinnerEl.style.display = 'block';
  micIcon.style.display = 'none';
}

function hideSpinner() {
  if (spinnerEl) spinnerEl.style.display = 'none';
  if (micIcon) micIcon.style.display = 'block';
}

function updateMicButtonState(state) {
    micState = state;
    if (!micButton || !micIcon) return;

    switch (state) {
        case 'recording':
            micIcon.src = RECORDING_ICON_URL;
            micButton.disabled = false;
            hideSpinner();
            if (processingTimeoutId) { clearTimeout(processingTimeoutId); processingTimeoutId = null; }
            playBeep(true);
            break;
        case 'processing':
            micIcon.src = PROCESSING_ICON_URL;
            micButton.disabled = true;
            showSpinner();
            if (processingTimeoutId) clearTimeout(processingTimeoutId);
            processingTimeoutId = setTimeout(() => {
                updateMicButtonState('idle');
                showOops();
            }, 30000);
            playBeep(false);
            break;
        case 'idle':
        default:
            micIcon.src = MIC_ICON_URL;
            micButton.disabled = false;
            hideSpinner();
            if (processingTimeoutId) { clearTimeout(processingTimeoutId); processingTimeoutId = null; }
            break;
    }
}

function recordSelection() {
  if(!activeElement) return;
  recordingTarget = activeElement;
  if(activeElement.isContentEditable) {
    const sel=window.getSelection();
    if(sel && sel.rangeCount>0) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  } else if(typeof activeElement.selectionStart==='number') {
    caretStart = activeElement.selectionStart;
    caretEnd = activeElement.selectionEnd;
  }
}


function handleMicClick(e) {
    e.preventDefault();
    e.stopPropagation();

    // Check if voice input is enabled for this site
    if (!siteEnabled) {
        console.log('Voice input is disabled on this site');
        return;
    }

    // Initialize AudioContext on the first user gesture
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (micState === 'idle') {
        recordSelection();
        // Start recording directly - permission was already granted during onboarding
        chrome.runtime.sendMessage({ type: 'start-recording' });
    } else if (micState === 'recording') {
        chrome.runtime.sendMessage({ type: 'stop-recording' });
    }
}

function positionMicButton(target) {
    if (!micButton) {
        micButton = createMicButton();
    }
    const rect = target.getBoundingClientRect();
    const btnH = micButton.offsetHeight || 36;
    const top = window.scrollY + rect.top + (rect.height - btnH)/2;
    const left = window.scrollX + rect.right - (btnH + 4);
    micButton.style.display = 'block';
    micButton.style.top = `${top}px`;
    micButton.style.left = `${left}px`;
}

function hideMicButton() {
    if (micButton) {
        micButton.style.display = 'none';
    }
}

function isEditable(element) {
    if (!element) return false;
    const tagName = element.tagName.toUpperCase();
    return (tagName === 'INPUT' && !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(element.type.toLowerCase())) ||
           tagName === 'TEXTAREA' ||
           element.isContentEditable;
}

document.addEventListener('focusin', (e) => {
    if (siteEnabled && isEditable(e.target)) {
        activeElement = e.target;
        positionMicButton(activeElement);
    }
});

document.addEventListener('focusout', (e) => {
    // Use a small timeout to prevent the button from disappearing when it's clicked
    setTimeout(() => {
        if (document.activeElement !== activeElement && document.activeElement !== micButton) {
            activeElement = null;
            hideMicButton();
        }
    }, 100);
});



// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
        case 'recording-started':
            updateMicButtonState('recording');
            break;
        case 'processing-started':
            updateMicButtonState('processing');
            break;
        case 'insert-text':
            const targetEl = recordingTarget || activeElement;
            if (targetEl) {
                const text = (request.text || '').trim();
                if(!text) {
                    showOops();
                    updateMicButtonState('idle');
                    break;
                }
                if (targetEl.isContentEditable) {
                    // Ensure the target has focus so Selection APIs work reliably
                    if (document.activeElement !== targetEl) {
                        targetEl.focus({ preventScroll: true });
                    }

                    // Retrieve the previously-saved range, or fall back to the current selection
                    const selection = window.getSelection();
                    let range = savedRange;
                    if (!range && selection && selection.rangeCount > 0) {
                        range = selection.getRangeAt(0).cloneRange();
                    }

                    if (range) {
                        // Replace the selected contents with the transcribed text
                        selection.removeAllRanges();
                        selection.addRange(range);

                        range.deleteContents();
                        const node = document.createTextNode(request.text);
                        range.insertNode(node);

                        // Move caret to the end of the inserted text
                        range.setStartAfter(node);
                        range.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    } else {
                        // If we somehow lost the range, append at the end
                        targetEl.textContent += request.text;
                    }
                } else if (typeof targetEl.selectionStart === 'number') {
                    const start = (caretStart!==null?caretStart:targetEl.selectionStart);
                    const end = (caretEnd!==null?caretEnd:targetEl.selectionEnd);
                    const value = targetEl.value;
                    targetEl.value = value.slice(0, start) + request.text + value.slice(end);
                    const pos = start + request.text.length;
                    targetEl.selectionStart = targetEl.selectionEnd = pos;
                } else {
                    targetEl.value += request.text;
                }
                // dispatch input & change events so page scripts react
                ['input','change'].forEach(evtName => {
                    const evt = new Event(evtName, { bubbles: true });
                    targetEl.dispatchEvent(evt);
                });
            }
            updateMicButtonState('idle');
            recordingTarget=null;
            break;
        case 'GET_MARKDOWN':
            // Handle async response properly
            (async () => {
                try {
                    if (!libsLoaded) await loadLibraries();
                    const markdown = await htmlToMarkdown(request.payload);
                    const tokenCount = estimateTokenCount(markdown);
                    // Markdown is now sent back to service worker to handle
                    sendResponse({ success: true, markdown: markdown, tokenCount: tokenCount });
                } catch (e) {
                    console.error('Error in GET_MARKDOWN handler:', e);
                    showToast('Failed to get page content. See console for details.', 3000);
                    sendResponse({ success: false, error: e.message });
                }
            })();
            return true; // Indicates async response
        case 'COPY_YOUTUBE_SUBTITLE':
            (async () => {
                try {
                    const result = await copyYouTubeSubtitle(request.payload);
                    sendResponse(result);
                } catch (e) {
                    console.error('Error in COPY_YOUTUBE_SUBTITLE handler:', e);
                    showToast('Failed to copy subtitles. See console for details.', 3000);
                    sendResponse({ success: false, error: e.message });
                }
            })();
            return true;
            break;
        case 'GET_YOUTUBE_SUBTITLE_FOR_ANALYSIS':
            (async () => {
                try {
                    const result = await getYouTubeSubtitleForAnalysis(request.payload);
                    sendResponse(result);
                } catch (e) {
                    console.error('Error in GET_YOUTUBE_SUBTITLE_FOR_ANALYSIS handler:', e);
                    sendResponse({ success: false, error: e.message });
                }
            })();
            return true;
            break;
        case 'COPY_TO_CLIPBOARD':
            // Handle clipboard copy requests from service worker
            (async () => {
                try {
                    await copyToClipboard(request.text);
                    const tokenCount = estimateTokenCount(request.text);
                    showToast(`Copied to clipboard! (${tokenCount} tokens)`, 3000, 'success');
                    sendResponse({ success: true, tokenCount: tokenCount });
                } catch (e) {
                    console.error('Error copying to clipboard:', e);
                    showToast('Failed to copy to clipboard. See console for details.', 3000);
                    sendResponse({ success: false, error: e.message });
                }
            })();
            return true; // Indicates async response
        case 'error':
            showToast(request.message || 'Sorry, something went wrong');
            updateMicButtonState('idle');
            break;
    }
});

async function htmlToMarkdown(htmlString) {
    if (!libsLoaded) await loadLibraries();

    const doc = new DOMParser().parseFromString(htmlString, 'text/html');
    let article;

    if (Readability) {
        try {
            article = new Readability(doc).parse();
        } catch (e) {
            console.warn("Readability failed, falling back to full body.", e);
        }
    }

    const contentToConvert = article ? article.content : doc.body.innerHTML;

    if (Turndown) {
        const turndownService = new Turndown();
        const tagsToRemove = ['head', 'style', 'script', 'iframe', 'video', 'audio', 'canvas', 'object', 'embed', 'noscript', 'footer', 'nav', 'aside', 'dialog'];
        turndownService.remove(tagsToRemove);
        return turndownService.turndown(contentToConvert);
    }

    // Fallback if Turndown is not loaded
    console.warn("Turndown library not loaded. Using basic text extraction.");
    return doc.body.innerText;
}

function convertToMarkdown(element) {
    if (!element) return '';
    
    let result = '';
    
    // Handle different node types
    for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            if (text) {
                result += text + ' ';
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();
            const content = convertToMarkdown(node);
            
            switch (tagName) {
                case 'h1':
                    result += `\n# ${content}\n\n`;
                    break;
                case 'h2':
                    result += `\n## ${content}\n\n`;
                    break;
                case 'h3':
                    result += `\n### ${content}\n\n`;
                    break;
                case 'h4':
                    result += `\n#### ${content}\n\n`;
                    break;
                case 'h5':
                    result += `\n##### ${content}\n\n`;
                    break;
                case 'h6':
                    result += `\n###### ${content}\n\n`;
                    break;
                case 'p':
                    result += `\n${content}\n\n`;
                    break;
                case 'br':
                    result += '\n';
                    break;
                case 'strong':
                case 'b':
                    result += `**${content}**`;
                    break;
                case 'em':
                case 'i':
                    result += `*${content}*`;
                    break;
                case 'code':
                    result += `\`${content}\``;
                    break;
                case 'pre':
                    result += `\n\`\`\`\n${content}\n\`\`\`\n\n`;
                    break;
                case 'blockquote':
                    const quotedContent = content.split('\n').map(line => `> ${line}`).join('\n');
                    result += `\n${quotedContent}\n\n`;
                    break;
                case 'ul':
                case 'ol':
                    result += `\n${content}\n`;
                    break;
                case 'li':
                    result += `- ${content}\n`;
                    break;
                case 'a':
                    const href = node.getAttribute('href');
                    if (href && content.trim()) {
                        result += `[${content}](${href})`;
                    } else {
                        result += content;
                    }
                    break;
                case 'img':
                    const src = node.getAttribute('src');
                    const alt = node.getAttribute('alt') || '';
                    if (src) {
                        result += `![${alt}](${src})`;
                    }
                    break;
                case 'div':
                case 'span':
                case 'section':
                case 'article':
                    result += content;
                    break;
                case 'table':
                    result += `\n${content}\n`;
                    break;
                case 'tr':
                    result += `${content}\n`;
                    break;
                case 'td':
                case 'th':
                    result += `${content} | `;
                    break;
                default:
                    // For unknown elements, just include their content
                    result += content;
                    break;
            }
        }
    }
    
    return result;
}

// --- YouTube subtitle handling ---
async function copyYouTubeSubtitle(videoId) {
    if (!libsLoaded) await loadLibraries();
    try {
        // Get video title from page or fallback
        const title = (
            document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent ||
            document.querySelector('#title')?.textContent ||
            document.querySelector('title')?.textContent ||
            'YouTube Video'
        ).trim();

        const subtitle = await getYouTubeSubtitle(videoId);

        if (!subtitle) {
            throw new Error('No subtitles found for this video');
        }

        const transcript = convertSrtToText(subtitle);
        const markdown = `# ${title}\n\n${transcript}`;

        const tokenCount = estimateTokenCount(markdown);

        const copySuccess = await copyToClipboard(markdown);
        if (!copySuccess) {
            throw new Error('Failed to copy to clipboard');
        }
        
        showToast(`Subtitle copied to clipboard (${tokenCount} tokens)`, 3000, 'success');
        return { success: true, tokenCount: tokenCount };
    } catch (err) {
        console.error('Failed to copy YouTube subtitles:', err);
        showToast('Failed to copy subtitles. See console for details.', 3000);
        throw err; // Re-throw so the handler can catch it
    }
}

async function getYouTubeSubtitleForAnalysis(videoId) {
    if (!libsLoaded) await loadLibraries();
    try {
        
        // Get video title from page or fallback
        const title = (
            document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent ||
            document.querySelector('#title')?.textContent ||
            document.querySelector('title')?.textContent ||
            'YouTube Video'
        ).trim();
        

        const subtitle = await getYouTubeSubtitle(videoId);

        if (!subtitle) {
            throw new Error('No subtitles found for this video');
        }

        const transcript = convertSrtToText(subtitle);
        
        const markdown = `# ${title}\n\n${transcript}`;

        return { success: true, markdown: markdown };
    } catch (err) {
        console.error('Failed to get YouTube subtitles for analysis:', err);
        throw err; // Re-throw so the handler can catch it
    }
}

async function getYouTubeSubtitle(videoId) {
    try {
        
        // First try to get video info from YouTube's internal API
        const videoInfo = await getYouTubeVideoInfo(videoId);
        
        if (videoInfo && videoInfo.captions && videoInfo.captions.playerCaptionsTracklistRenderer) {
            const captionTracks = videoInfo.captions.playerCaptionsTracklistRenderer.captionTracks;
            
            if (captionTracks && captionTracks.length > 0) {
                // Prefer English captions, then any available
                let selectedTrack = captionTracks.find(track => 
                    track.languageCode === 'en' || track.languageCode === 'en-US'
                ) || captionTracks[0];
                
                
                if (selectedTrack && selectedTrack.baseUrl) {
                    const url = new URL(selectedTrack.baseUrl);
                    url.searchParams.set('fmt', 'srt');
                    
                    const response = await fetch(url.toString());
                    if (response.ok) {
                        const srt = await response.text();
                        return srt.trim() || null;
                    } else {
                        console.warn('Failed to fetch subtitles, status:', response.status);
                    }
                } else {
                    console.warn('No baseUrl in selected track');
                }
            } else {
                console.warn('No caption tracks found');
            }
        } else {
            console.warn('No captions in video info');
        }
        
        // Fallback: try to get subtitles from the page directly
        const fallbackSubtitles = await getYouTubeSubtitlesFromPage();
        if (fallbackSubtitles) {
            return fallbackSubtitles;
        }
        
        return null;
               
    } catch (e) {
        console.warn('YouTube subtitle fetch failed:', e);
        
        // Try fallback even if main method fails
        try {
            const fallbackSubtitles = await getYouTubeSubtitlesFromPage();
            if (fallbackSubtitles) {
                return fallbackSubtitles;
            }
        } catch (fallbackError) {
            console.warn('Fallback method also failed:', fallbackError);
        }
        
        return null;
    }
}

async function getYouTubeSubtitlesFromPage() {
    try {
        // Try to get subtitles from the page's subtitle elements
        const subtitleElements = document.querySelectorAll('.ytp-caption-segment');
        if (subtitleElements.length > 0) {
            const subtitles = Array.from(subtitleElements).map(el => el.textContent.trim()).filter(text => text);
            if (subtitles.length > 0) {
                return subtitles.join('\n\n');
            }
        }
        
        // Try alternative selectors
        const altSubtitleElements = document.querySelectorAll('[data-purpose="captions-text"]');
        if (altSubtitleElements.length > 0) {
            const subtitles = Array.from(altSubtitleElements).map(el => el.textContent.trim()).filter(text => text);
            if (subtitles.length > 0) {
                return subtitles.join('\n\n');
            }
        }
        
        return null;
    } catch (e) {
        console.warn('Failed to get subtitles from page:', e);
        return null;
    }
}

async function getYouTubeVideoInfo(videoId) {
    try {
        
        const response = await fetch('https://www.youtube.com/youtubei/v1/player', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                context: {
                    client: {
                        clientName: 'WEB',
                        clientVersion: '2.20241205.05.00',
                    },
                },
                videoId: videoId,
            }),
        });
        
        
        if (response.ok) {
            const data = await response.json();
            return data;
        } else {
            console.warn('YouTube API request failed with status:', response.status);
        }
    } catch (e) {
        console.warn('Failed to get YouTube video info:', e);
    }
    return null;
}


function convertSrtToText(srt) {
    const lines = srt.split(/\r?\n/);
    const output = [];
    let currentText = '';
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip sequence numbers and timestamps
        if (!line || /^\d+$/.test(line) || line.includes('-->')) {
            continue;
        }
        
        // Process subtitle text
        if (line) {
            // Remove HTML tags that might be in subtitles
            const cleanLine = line.replace(/<[^>]*>/g, '');
            if (cleanLine) {
                currentText += cleanLine + ' ';
            }
        }
        
        // Add paragraph break for empty lines (subtitle separation)
        if (!line && currentText.trim()) {
            output.push(currentText.trim());
            currentText = '';
        }
    }
    
    // Add any remaining text
    if (currentText.trim()) {
        output.push(currentText.trim());
    }
    
    return output.join('\n\n');
}

function estimateTokenCount(text) {
    if (libsLoaded && tiktoken) {
        try {
            const tokens = tiktoken.encode(text);
            return tokens.length;
        } catch (error) {
            console.warn('tiktoken failed, using fallback estimation:', error);
        }
    }
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

async function copyToClipboard(text) {
    // Try Clipboard API only if page is focused
    if (document.hasFocus() && navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            // Continue to fallback
            console.debug('Clipboard API failed, using fallback:', error);
        }
    }

    // Fallback method using hidden textarea
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return true;
    } catch (err) {
        console.error('Clipboard fallback failed:', err);
        return false;
    }
}