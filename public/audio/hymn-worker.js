/* MediaPipe is vendored with this site; audio never leaves this worker. */
importScripts("/audio/vendor/audio_bundle.js");
let classifier;
self.onmessage = async ({ data }) => {
  try {
    if (data.init) {
      const files = await Audio.FilesetResolver.forAudioTasks("/audio/vendor/wasm");
      classifier = await Audio.AudioClassifier.createFromOptions(files, {
        baseOptions: { modelAssetPath: "/audio/yamnet.tflite" },
        maxResults: -1,
      });
      self.postMessage({ ready: true });
      return;
    }
    const results = classifier.classify(data.samples, data.sampleRate);
    let singing = 0, speech = 0;
    for (const result of results) {
      for (const head of result.classifications) {
        for (const category of head.categories) {
          if (["Singing", "Choir", "Child singing"].includes(category.categoryName)) singing = Math.max(singing, category.score);
          if (["Speech", "Conversation", "Narration, monologue"].includes(category.categoryName)) speech = Math.max(speech, category.score);
        }
      }
    }
    self.postMessage({ singing, speech, at: data.at });
  } catch { self.postMessage({ error: true }); }
};
