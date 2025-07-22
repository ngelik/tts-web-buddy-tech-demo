let currentStep = 1;
let microphoneGranted = false;

// Simple toast for non-blocking messages
function showToast(message, duration = 3000) {
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
    Object.assign(toast.style, {
        background: 'rgba(220,53,69,0.95)',
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

// Initialize the page
document.addEventListener('DOMContentLoaded', () => {
    updateStepDisplay();
    loadExistingApiKey();
    setupEventListeners();
});

function setupEventListeners() {
    // Step 1 - Welcome
    document.getElementById('getStartedBtn')?.addEventListener('click', nextStep);
    
    // Step 2 - API Key
    document.getElementById('backFromApiBtn')?.addEventListener('click', prevStep);
    document.getElementById('saveApiKeyBtn')?.addEventListener('click', saveApiKey);
    
    // Step 3 - Microphone Permission
    document.getElementById('backFromMicBtn')?.addEventListener('click', prevStep);
    document.getElementById('micPermissionBtn')?.addEventListener('click', requestMicrophonePermission);
    document.getElementById('continueAfterMic')?.addEventListener('click', nextStep);
    
    // Step 4 - Finish
    document.getElementById('finishSetupBtn')?.addEventListener('click', finishSetup);
    
    // Allow Enter key to submit API key
    document.getElementById('apiKeyInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveApiKey();
        }
    });
}

function updateStepDisplay() {
    // Update progress bar
    document.querySelectorAll('.step').forEach(step => {
        const stepNumber = parseInt(step.dataset.step);
        step.classList.remove('active', 'completed');
        
        if (stepNumber < currentStep) {
            step.classList.add('completed');
        } else if (stepNumber === currentStep) {
            step.classList.add('active');
        }
    });

    // Update content visibility
    document.querySelectorAll('.step-content').forEach(content => {
        content.classList.remove('active');
    });
    
    const activeContent = document.querySelector(`.step-content[data-step="${currentStep}"]`);
    if (activeContent) {
        activeContent.classList.add('active');
    }
}

function nextStep() {
    if (currentStep < 4) {
        currentStep++;
        updateStepDisplay();
    }
}

function prevStep() {
    if (currentStep > 1) {
        currentStep--;
        updateStepDisplay();
    }
}

async function loadExistingApiKey() {
    try {
        const result = await chrome.storage.local.get('ttsbuddy-api-key');
        if (result['ttsbuddy-api-key']) {
            document.getElementById('apiKeyInput').value = result['ttsbuddy-api-key'];
        }
    } catch (error) {
        console.error('Error loading API key:', error);
    }
}

async function saveApiKey() {
    const apiKey = document.getElementById('apiKeyInput').value.trim();
    
    if (!apiKey) {
        showToast('Please enter your TTSBuddy API key');
        return;
    }
    
    try {
        await chrome.storage.local.set({ 'ttsbuddy-api-key': apiKey });
        nextStep();
    } catch (error) {
        console.error('Error saving API key:', error);
        showToast('Error saving API key. Please try again.');
    }
}

async function requestMicrophonePermission() {
    const button = document.getElementById('micPermissionBtn');
    const continueBtn = document.getElementById('continueAfterMic');
    
    button.textContent = 'Requesting permission...';
    button.disabled = true;
    
    try {
        
        // Request microphone permission from the extension context
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        // Stop the stream immediately - we just wanted to get permission
        stream.getTracks().forEach(track => track.stop());
        
        microphoneGranted = true;
        
        button.textContent = '✅ Microphone Access Granted';
        button.style.background = '#34a853';
        
        // Show continue button
        continueBtn.classList.remove('hidden');
        
        // Auto-advance after 2 seconds
        setTimeout(() => {
            nextStep();
        }, 2000);
        
    } catch (error) {
        console.error('Microphone permission denied:', error);
        
        button.textContent = 'Permission Denied - Try Again';
        button.disabled = false;
        button.style.background = '#ea4335';
        
        if (error.name === 'NotAllowedError') {
            showToast('Microphone permission was denied. Please click "Allow" when Chrome asks for microphone permission.');
        } else if (error.name === 'NotFoundError') {
            showToast('No microphone found. Please connect a microphone and try again.');
        } else {
            showToast(`Error: ${error.message}`);
        }
        
        // Reset button after 3 seconds
        setTimeout(() => {
            button.textContent = 'Allow Microphone Access';
            button.style.background = '#34a853';
        }, 3000);
    }
}

function finishSetup() {
    // Mark onboarding as complete and microphone permission granted
    chrome.storage.local.set({ 
        'onboarding-complete': true,
        'microphone-permission-granted': microphoneGranted 
    });
    
    // Close the onboarding tab
    window.close();
}

// Handle window closing
window.addEventListener('beforeunload', () => {
    // If we got to step 4 or microphone was granted, mark as complete
    if (currentStep >= 4 || microphoneGranted) {
        chrome.storage.local.set({ 'onboarding-complete': true });
    }
}); 
