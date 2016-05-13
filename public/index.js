// These are configurable constants:
var MIN_DB_LEVEL = -85;      // The dB level that is 0 in the levels display
var MAX_DB_LEVEL = -30;      // The dB level that is 100% in the levels display
var LOUD_THRESHOLD = -40;    // Above this dB level we display in red
var SILENCE_THRESHOLD = -65; // Levels below this db threshold count as silence
var SILENCE_DURATION = 1.5;  // How many seconds of quiet before stop recording
var RECORD_BEEP_HZ = 800;    // Frequency and duration of beeps
var RECORD_BEEP_MS = 200;
var STOP_BEEP_HZ = 400;
var STOP_BEEP_MS = 300;

// The microphone stream we get from getUserMedia
var microphone;

// The sentences we want the user to read and their corresponding
// server-side directories that we upload them to.  We fetch these
// from the server. See getSentences() and parseSentences().
var sentences = [], directories = [];

// The sentence we're currently recording, and its directory.
// These are picked at random in recordingScreen.show()
var currentSentence, currentDirectory;

// These are some things that can go wrong:
var ERR_PLATFORM = 'Your browser does not support audio recording.';
var ERR_NO_CONSENT = 'You did not consent to recording. ' +
    'You must click the "I Agree" button in order to use this website.';
var ERR_NO_MIC = 'You did not allow this website to use the microphone. ' +
    'The website needs the microphone to record your voice.';
var ERR_UPLOAD_FAILED = 'Uploading your recording to the server failed. ' +
    'This may be a temporary problem. Please try again.';

// This is the program startup sequence.
checkPlatformSupport()
  .then(getConsent)
  .then(getMicrophone)
  .then(rememberMicrophone)
  .then(getSentences)
  .then(parseSentences)
  .then(initializeAndRun)
  .catch(displayErrorMessage);

function checkPlatformSupport() {
  function isWebAudioSupported() {
    return typeof window.AudioContext === 'function'
  }

  function isGetUserMediaSupported() {
    var gum = (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ||
      navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia;
    return typeof gum === 'function';
  }

  function isMediaRecorderSupported() {
    return typeof window.MediaRecorder === 'function';
  }

  if (!isGetUserMediaSupported() || 
      !isWebAudioSupported() ||
      !isMediaRecorderSupported()) {
    return Promise.reject(ERR_PLATFORM);
  }
  else {
    return Promise.resolve(true);
  }
}

// Ask the user to agree to place the recordings in the public domain.
// They only have to agree once, and we remember using localStorage
function getConsent() {
  return new Promise(function(resolve, reject) {
    // If the user has already consented, then we're done
    if (localStorage.consentGiven) {
      resolve();
      return;
    }
    // Otherwise, display the consent screen and wait for a response
    var consentScreen = document.querySelector('#consent-screen');
    consentScreen.hidden = false;
    document.querySelector('#agree').onclick = function() {
      localStorage.consentGiven = true;  // Remember this consent
      consentScreen.hidden = true;
      resolve();
    };
    document.querySelector('#disagree').onclick = function() {
      consentScreen.hidden = true;
      reject(ERR_NO_CONSENT);
    };
  });
}

// Use getUserMedia() to get access to the user's microphone.
// This can fail because the browser does not support it, or
// because the user does not give permission.
function getMicrophone() {
  return new Promise(function(resolve,reject) {
    // Reject the promise with a 'permission denied' error code
    function deny() { reject(ERR_NO_MIC); }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({audio: true}).then(resolve, deny);
    }
    else if (navigator.getUserMedia) {
      navigator.getUserMedia({audio:true}, resolve, deny);
    }
    else if (navigator.webkitGetUserMedia) {
      navigator.webkitGetUserMedia({audio:true}, resolve, deny);
    }
    else if (navigator.mozGetUserMedia) {
      navigator.mozGetUserMedia({audio:true}, resolve, deny);
    }
    else {
      reject(ERR_PLATFORM);  // Browser does not support getUserMedia
    }
  });
}

// When we get the microphone audio stream, remember it in a global variable.
function rememberMicrophone(stream) {
  microphone = stream;
}

// Fetch the sentences.json file that tell us what sentences
// to ask the user to read
function getSentences() {
  return fetch('sentences.json').then(function(r) { return r.json(); });
}

// Once we get the json file, break the keys and values into two
// parallel arrays.
function parseSentences(directoryToSentenceMap) {
  for(var d in directoryToSentenceMap) {
    directories.push(d);
    sentences.push(directoryToSentenceMap[d]);
  }
}

// If anything goes wrong in the app startup sequence, this function
// is called to tell the user what went wrong
function displayErrorMessage(error) {
  document.querySelector('#consent-screen').hidden = true;
  document.querySelector('#error-screen').hidden = false;
  document.querySelector('#error-message').textContent = error;

  if (error === ERR_PLATFORM) {
    // Fatal error. Just show a table of supported browsers
    document.querySelector('#error-reload').hidden = true;
    document.querySelector('#error-supported').hidden = false;
  }
  else {
    // Otherwise, the user can correct the errror. Invite them to reload
    document.querySelector('#error-reload').hidden = false;
    document.querySelector('#error-supported').hidden = true;
  }
}

// Once the async initialization is complete, this is where the
// program really starts. It initializes the recording and playback
// screens, and sets up event handlers to switch back and forth between
// those screens until the user gets tired of making recordings.
function initializeAndRun() {
  // Get the DOM elements for the recording and playback screens
  var recordingScreenElement = document.querySelector('#record-screen');
  var playbackScreenElement = document.querySelector('#playback-screen');

  // Create objects that encapsulate their functionality
  // Then set up event handlers to coordinate the two screens
  var recordingScreen = new RecordingScreen(recordingScreenElement, microphone);
  var playbackScreen = new PlaybackScreen(playbackScreenElement);

  // When a recording is complete, pass it to the playback screen
  recordingScreenElement.addEventListener('record', function(event) {
    recordingScreen.hide();
    playbackScreen.show(event.detail);
  });

  // If the user clicks 'Upload' on the playback screen, do the upload
  // and switch back to the recording screen for a new sentence
  playbackScreenElement.addEventListener('upload', function(event) {
    upload(currentDirectory, event.detail);
    switchToRecordingScreen(true);
  });

  // If the user clicks 'Discard', switch back to the recording screen
  // for another take of the same sentence
  playbackScreenElement.addEventListener('discard', function() {
    switchToRecordingScreen(false);
  });

  // Here's how we switch to the recording screen
  function switchToRecordingScreen(needNewSentence) {
    // Pick a random sentence if we don't have one or need a new one
    if (needNewSentence || !currentSentence) {
      var n = Math.floor(Math.random() * sentences.length);
      currentSentence = sentences[n];
      currentDirectory = directories[n];
    }

    // Hide the playback screen (and release its audio) if it was displayed
    // Show the recording screen
    playbackScreen.hide();
    recordingScreen.show(currentSentence);
  }

  // Upload a recording using the fetch API to do an HTTP POST
  function upload(directory, recording) {
    fetch('/upload/' + directory, { method: 'POST', body: recording })
      .then(function(response) {
        if (response.status !== 200) {
          playbackScreen.hide();
          recordingScreen.hide();
          displayErrorMessage(ERR_UPLOAD_FAILED + ' ' + response.status + ' ' +
                              response.statusText);
        }
      })
      .catch(function() {
        playbackScreen.hide();
        recordingScreen.hide();
        displayErrorMessage(ERR_UPLOAD_FAILED);
      });
  }

  // Finally, we start the app off by displaying the recording screen
  switchToRecordingScreen(true);
}

// The RecordingScreen object has show() and hide() methods and fires
// a 'record' event on its DOM element when a recording has been made.
function RecordingScreen(element, microphone) {
  this.element = element;

  // A RecordingScreen object has methods for hiding and showing.
  // Everything else is private inside this constructor
  this.show = function(sentence) {
    this.element.querySelector('#sentence').textContent = sentence;
    this.element.hidden = false;
    visualize();
  };

  this.hide = function() {
    this.element.hidden = true;
  };

  // Build the WebAudio graph we'll be using
  var audioContext = new AudioContext();
  var sourceNode = audioContext.createMediaStreamSource(microphone);
  var volumeNode = audioContext.createGain();
  var analyzerNode = audioContext.createAnalyser();
  var outputNode = audioContext.createMediaStreamDestination();
  analyzerNode.fftSize = 64;
  sourceNode.connect(volumeNode);
  volumeNode.connect(analyzerNode);
  analyzerNode.connect(outputNode);
  var recorder = new MediaRecorder(outputNode.stream);
  recorder.addEventListener('dataavailable', recordingStopped);

  // FFT size 64 gives us 32 bins. But those bins hold frequencies up to
  // 22kHz or more, and we only care about visualizing lower frequencies
  // which is where most human voice lies.
  var frequencyBins = new Float32Array(14);

  // This canvas object displays the audio levels for the incoming signal
  var levels = element.querySelector('#levels');

  var recording = false;  // Are we currently recording?
  var lastSoundTime;      // When was the last time we heard a sound?

  var recordButton = element.querySelector('#recordButton');

  // The button responds to clicks to start and stop recording
  recordButton.addEventListener('click', function() {
    // Don't respond if we're disabled
    if (recordButton.className === 'disabled')
      return;

    if (recording) {
      stopRecording();
    }
    else {
      startRecording();
    }
  });


  // How much we amplify the signal from the microphone.
  // If we've got a saved value, use that.
  var microphoneGain = parseFloat(localStorage.microphoneGain);

  // If no saved value, start with a reasonable default
  // See PlaybackScreen for the code that allows the user to change this
  if (!microphoneGain) {
    // Need to turn the sensitivity way up on Android
    if (navigator.userAgent.indexOf('ndroid') !== -1) {
      microphoneGain = 6;
    }
    else {
      microphoneGain = 2;
    }
    localStorage.microphoneGain = microphoneGain
  }

  var sensitivity = element.querySelector('#sensitivity');
  sensitivity.onchange = function() {
    microphoneGain = parseFloat(this.value)/10;
    volumeNode.gain.value = microphoneGain
    localStorage.microphoneGain = microphoneGain;
  };
  sensitivity.value = microphoneGain * 10;
  volumeNode.gain.value = microphoneGain;

  function startRecording() {
    if (!recording) {
      recording = true;
      recordButton.className = 'disabled'; // disabled 'till after the beep
      beep(RECORD_BEEP_HZ, RECORD_BEEP_MS).then(function() {
        lastSoundTime = audioContext.currentTime;
        recorder.start();
        recordButton.className = 'recording';
      });
    }
  }

  function stopRecording() {
    if (recording) {
      recording = false;
      recordButton.className = 'disabled'; // disabled 'till after the beep
      // XXX this sometimes says
      // InvalidStateError: An attempt was made to use an object that is not, or is no longer, usable
      // So maybe recreate the recorder for each invocation?
      recorder.stop();

      // The line above will trigger the recordingStopped() function below
    }
  }

  function recordingStopped(event) {
    // Beep to tell the user the recording is done
    beep(STOP_BEEP_HZ, STOP_BEEP_MS).then(function() {
      recordButton.className = '';
    });

    // Broadcast an event containing the recorded blob
    element.dispatchEvent(new CustomEvent('record', {
      detail: event.data
    }));
  }

  // A WebAudio utility to do simple beeps
  function beep(hertz, duration, volume) {
    return new Promise(function(resolve, reject) {
      var context = new AudioContext();
      var oscillator = context.createOscillator();
      var gain = context.createGain();
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.frequency.value = hertz;
      gain.gain.value = volume || 0.5; // a little soft by default
      oscillator.start();
      oscillator.stop(context.currentTime + duration/1000);
      oscillator.onended = function() {
        oscillator.disconnect();
        gain.disconnect();
        context.close();
        // The sound may not have actually stopped playing yet, so
        // wait a bit longer before calling resolve(). This is particularly
        // a problem on Chrome.
        setTimeout(resolve, 50);
      };
    });
  }

  function visualize() {
    // Clear the canvas
    var context = levels.getContext('2d');
    context.clearRect(0, 0, levels.width, levels.height);

    if (element.hidden) {
      // If we've been hidden, return right away without calling rAF again.
      return;
    }

    // Get the FFT data
    analyzerNode.getFloatFrequencyData(frequencyBins);

    // Display it as a barchart.
    // Drop bottom few bins, since they are often misleadingly high
    var skip = 2;
    var n = frequencyBins.length - skip;
    var barwidth = levels.width/n;
    var maxValue = MIN_DB_LEVEL;
    var dbRange = (MAX_DB_LEVEL - MIN_DB_LEVEL);

    // Loop through the values and draw the bars
    // while we're at it, find the maximum value
    context.fillStyle = 'green';
    for(var i = 0; i < n; i++) {
      var value = frequencyBins[i+skip];
      if (value > maxValue) maxValue = value;
      var height = levels.height * (value - MIN_DB_LEVEL) / dbRange;
      context.fillRect(i * barwidth, levels.height - height,
                       barwidth, height);
    }

    // loop again and make the top of the bars red for high volumes
    context.fillStyle = 'red';
    var thresholdHeight =
        levels.height * (LOUD_THRESHOLD - MIN_DB_LEVEL) / dbRange;
    for(var i = 0; i < n; i++) {
      var value = frequencyBins[i+skip];
      if (value > LOUD_THRESHOLD) {
        var height = levels.height * (value - MIN_DB_LEVEL) / dbRange;
        context.fillRect(i * barwidth, levels.height - height,
                         barwidth, height - thresholdHeight);
      }
    }

    // If we are currently recording, then test to see if the user has
    // been silent for long enough that we should stop recording
    if (recording) {
      var now = audioContext.currentTime;
      if (maxValue < SILENCE_THRESHOLD) {
        if (now - lastSoundTime > SILENCE_DURATION) {
          stopRecording();
        }
      }
      else {
        lastSoundTime = now;
      }
    }

    // Update the visualization the next time we can
    requestAnimationFrame(visualize);
  }
}

// This simple class encapsulates the playback screen. It has
// show and hide methods, and fires 'upload' and 'discard' events
// depending on which button is clicked.
function PlaybackScreen(element) {
  this.element = element;
  this.player = element.querySelector('#player');

  this.show = function(recording) {
    this.element.hidden = false;
    this.recording = recording;
    this.player.src = URL.createObjectURL(recording);
  };

  this.hide = function() {
    this.element.hidden = true;
    this.recording = null;
    if (this.player.src) {
      URL.revokeObjectURL(this.player.src);
      delete this.player.src;
      this.player.load();
    }
  };

  element.querySelector('#upload').addEventListener('click', function() {
    element.dispatchEvent(new CustomEvent('upload', {detail: this.recording}));
  }.bind(this));

  element.querySelector('#discard').addEventListener('click', function() {
    element.dispatchEvent(new CustomEvent('discard'));
  });
}
