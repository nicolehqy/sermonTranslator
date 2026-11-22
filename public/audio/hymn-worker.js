/* MediaPipe is vendored with this site; audio never leaves this worker. */
let stage = "loading runtime";
function progress(value) { stage = value; self.postMessage({ stage }); }
let classifier;
self.onmessage = async ({ data }) => {
  try {
    if (data.init) {
      progress("loading runtime");
      importScripts("/audio/vendor/audio_bundle.js");
      progress("checking WebAssembly support");
      const files = await Audio.FilesetResolver.forAudioTasks("/audio/vendor/wasm");
      progress("downloading music model");
      const response = await fetch("/audio/yamnet.tflite", { credentials: "same-origin" });
      if (response.redirected || [401, 403].includes(response.status)) throw new Error("Access expired. Reload and enter the site access code.");
      if (!response.ok) throw new Error(`Model download failed (HTTP ${response.status}).`);
      if ((response.headers.get("content-type") || "").includes("text/html")) throw new Error("Expected the music model but received a web page. Reload and sign in again.");
      const model = new Uint8Array(await response.arrayBuffer());
      progress("initializing WebAssembly and music model");
      classifier = await Audio.AudioClassifier.createFromOptions(files, {
        baseOptions: { modelAssetBuffer: model },
        maxResults: -1,
      });
      self.postMessage({ ready: true });
      return;
    }
    stage = "classifying audio";
    const results = classifier.classify(data.samples, data.sampleRate);
    let singing = 0, speech = 0, music = 0;
    for (const result of results) {
      for (const head of result.classifications) {
        for (const category of head.categories) {
          if (["Singing", "Choir", "Child singing", "Chant", "Mantra", "Humming"].includes(category.categoryName)) singing = Math.max(singing, category.score);
          if (["Music", "Vocal music", "Christian music", "Gospel music"].includes(category.categoryName)) music = Math.max(music, category.score);
          if (["Speech", "Conversation", "Narration, monologue"].includes(category.categoryName)) speech = Math.max(speech, category.score);
        }
      }
    }
    self.postMessage({ singing, speech, music, at: data.at });
  } catch (error) {
    self.postMessage({ error: true, stage, message: String(error?.message || error).slice(0, 400) });
  }
};
