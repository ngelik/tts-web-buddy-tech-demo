let recorder;
let data = [];
let stream; // Keep a reference to the stream to stop it on error
let audio; // For TTS playback
let audioCtx; // For beeps

function playBeep(isStart) {
    if (!audioCtx) {
        try {
            audioCtx = new (AudioContext || webkitAudioContext)();
        } catch (e) {
            console.error("Could not create AudioContext for beep.", e);
            return;
        }
    }
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    gainNode.gain.value = 0.1;
    oscillator.frequency.value = isStart ? 880 : 440;
    oscillator.type = 'sine';
    oscillator.start();
    setTimeout(() => oscillator.stop(), 100);
}

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'start-recording') {
    if (recorder?.state === 'recording') {
      return;
    }

    try {      // This should trigger Chrome's native permission dialog
      stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (error) {
      
      if (error.name === 'NotAllowedError') {
        // User explicitly denied or dismissed the permission dialog
        chrome.runtime.sendMessage({ type: 'permission-denied' });
      } else if (error.name === 'NotFoundError') {
        chrome.runtime.sendMessage({ 
          type: 'permission-denied', 
          error: 'No microphone found. Please connect a microphone and try again.' 
        });
      } else {
        chrome.runtime.sendMessage({ 
          type: 'permission-denied', 
          error: `Microphone error: ${error.message}` 
        });
      }
      return;
    }

    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

    recorder.ondataavailable = e => data.push(e.data);

    recorder.onstop = () => {
      const blob = new Blob(data, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = () => {
        // The result has the format "data:audio/webm;base64,..."
        const base64data = reader.result;
        chrome.runtime.sendMessage({ type: 'audio-blob-ready', dataUrl: base64data });
        // Clean up
        stream.getTracks().forEach(track => track.stop());
        data = [];
        recorder = null;
        stream = null;
      };
      reader.readAsDataURL(blob);
    };

    data = [];
    recorder.start();
    chrome.runtime.sendMessage({ type: 'recording-started-offscreen' });
  } else if (message.type === 'stop-recording') {
    if (recorder?.state === 'recording') {
      recorder.stop();
    }
  } else if (message.type === 'PLAY_AUDIO') {
    if (audio && !audio.paused) {
        audio.pause();
    }
    audio = new Audio(message.dataUrl);
    audio.play().catch(e => console.error("Audio playback failed:", e));
    audio.onended = () => {
        chrome.runtime.sendMessage({ type: 'TTS_FINISHED' });
        audio = null;
    };
  } else if (message.type === 'PLAY_BEEP') {
    playBeep(message.isStart);
  } else if (message.type === 'STOP_AUDIO') {
    if (audio) {
      audio.pause();
      audio.onended = null;
      audio = null;
    }
  }
}); 