import {mountMicrophoneCapture} from './microphone-capture.js';

if (['panel','workspace'].includes(new URLSearchParams(location.search).get('mode')) && window.desktop?.microphone) {
  mountMicrophoneCapture(window.desktop.microphone);
}
