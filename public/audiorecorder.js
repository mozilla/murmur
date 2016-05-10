//
// This is a simple class for recording mono audio from a getUserMedia()
// microphone stream and converting it to a WAV-format blob.  To use it, get a
// microphone stream with getUserMedia or, then pass that stream to the
// AudioRecorder() constructor. To start recording call the start method. To
// stop recording, call the stop() method.  The stop method returns a blob in
// WAV format. All the audio data is held in memory, in uncompressed form, and
// requires about 192kb of memory for each second of audio, so this class is
// not suitable for long recordings.
//
// By default, audio is collected in batches of 1024 samples (at about 40
// batches per second, though this depends on the platform's sampling rate).
// You can change the batch size by passing a different value as the optional
// second argument to the constructor. Note, however, that the batch size must
// be a power of two. If you set the onbatch property of an audiorecorder
// object then each batch (a Float32Array) will be passed to that function
// when it is collected.
//
// This code was inspired by, but simplified from this blog post
// http://typedarray.org/from-microphone-to-wav-with-getusermedia-and-web-audio/
//
(function(exports) {
  'use strict';

  function AudioRecorder(microphone, batchSize) {
    this.context = new AudioContext();
    this.source = this.context.createMediaStreamSource(microphone);
    this.volume = this.context.createGain();
    this.batchSize = batchSize || 1024;
    // In Firefox we don't need the one output channel, but we need
    // it for Chrome, even though it is unused.
    this.processor = this.context.createScriptProcessor(this.batchSize, 1, 1);
    this.batches = []; // batches of sample data from the script processor

    // Each time we get a batch of data, this function will be called
    // We just copy the typed array and save it. We end up with a long
    // array of typed arrays.
    this.processor.addEventListener('audioprocess', function(e) {
      var data = e.inputBuffer.getChannelData(0);
      var copy = new Float32Array(data);
      this.batches.push(copy);
      if (this.onbatch) { // If the user has defined a callback, call it
        this.onbatch(copy);
      }
    }.bind(this));
  }

  // The microphone is live the entire time. To start recording we
  // connect the microphone stream to the processor node.
  AudioRecorder.prototype.start = function(gain) {
    if (gain) {
      this.volume.gain.value = gain;
    }
    this.source.connect(this.volume);
    this.volume.connect(this.processor);
    // For Chrome we also have to connect the processor to the
    // destination even though the processor does not produce any output
    this.processor.connect(this.context.destination);
  };

  // To stop recording, disconnect the microphone.
  // Then take the data we stored and convert to a WAV format blob
  AudioRecorder.prototype.stop = function() {
    this.source.disconnect();
    this.volume.disconnect();
    this.processor.disconnect();
    var batches = this.batches;
    this.batches = [];
    return makeWAVBlob(batches, this.batchSize, this.context.sampleRate);
  };

  // Convert the sound samples we've collected into a WAV file
  function makeWAVBlob(batches, batchSize, sampleRate) {
    var numSamples = batches.length * batchSize;
    //  44 byte WAV header plus two bytes per sample
    var blobSize = numSamples * 2 + 44;
    var bytes = new ArrayBuffer(blobSize);
    var view = new DataView(bytes);

    // Create WAV file header
    view.setUint32(0, 0x46464952, true);      // 'RIFF'
    view.setUint32(4, blobSize - 8, true);    // Size of rest of file
    view.setUint32(8, 0x45564157, true);      // 'WAVE'
    view.setUint32(12, 0x20746d66, true);     // 'fmt '
    view.setUint32(16, 16, true);             // 16 bytes of fmt view
    view.setUint16(20, 1, true);              // Audio is in PCM format
    view.setUint16(22, 1, true);              // One-channel (mono)
    view.setUint32(24, sampleRate, true);     // Samples per second
    view.setUint32(28, 2*sampleRate, true);   // Bytes per second
    view.setUint16(32, 2, true);              // Block size
    view.setUint16(34, 16, true);             // Bits per sample
    view.setUint32(36, 0x61746164, true);     // 'data'
    view.setUint32(40, numSamples*2, true);   // How many data bytes

    // Copy the samples to the file now
    var offset = 44;
    for(var i = 0; i < batches.length; i++) {
      var batch = batches[i];
      for(var j = 0; j < batch.length; j++) {
        var floatSample = batch[j];
        var intSample = floatSample * 0x7FFF;  // convert to 16-bit signed int
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }

    return new Blob([bytes], { type: 'audio/wav' });
  }

  exports.AudioRecorder = AudioRecorder;
}(window));
