class StereoPcmQueue {
  constructor(capacityFrames, prebufferFrames) {
    this.capacityFrames = capacityFrames;
    this.prebufferFrames = prebufferFrames;
    this.buffer = new Float32Array(capacityFrames * 2);
    this.readFrame = 0;
    this.writeFrame = 0;
    this.availableFrames = 0;
    this.playing = false;
  }

  push(arrayBuffer) {
    if (!arrayBuffer || typeof arrayBuffer.byteLength !== "number" || arrayBuffer.byteLength < 4) return;
    const pcm = new Int16Array(arrayBuffer, 0, Math.floor(arrayBuffer.byteLength / 2));
    const incomingFrames = Math.floor(pcm.length / 2);

    for (let frame = 0; frame < incomingFrames; frame += 1) {
      if (this.availableFrames === this.capacityFrames) {
        this.readFrame = (this.readFrame + 1) % this.capacityFrames;
        this.availableFrames -= 1;
      }
      const target = this.writeFrame * 2;
      this.buffer[target] = pcm[frame * 2] / 32_768;
      this.buffer[target + 1] = pcm[frame * 2 + 1] / 32_768;
      this.writeFrame = (this.writeFrame + 1) % this.capacityFrames;
      this.availableFrames += 1;
    }
  }

  mixInto(left, right) {
    if (!this.playing && this.availableFrames >= this.prebufferFrames) this.playing = true;
    if (!this.playing) return;

    for (let frame = 0; frame < left.length; frame += 1) {
      if (this.availableFrames === 0) {
        this.playing = false;
        break;
      }
      const source = this.readFrame * 2;
      left[frame] += this.buffer[source];
      right[frame] += this.buffer[source + 1];
      this.readFrame = (this.readFrame + 1) % this.capacityFrames;
      this.availableFrames -= 1;
    }
  }
}

class ResenhazinhaPcmMixer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queues = new Map();
    this.port.onmessage = (event) => {
      const streamId = String(event.data?.streamId || "application");
      const pcm = event.data?.pcm;
      let queue = this.queues.get(streamId);
      if (!queue) {
        queue = new StereoPcmQueue(48_000, 3_840);
        this.queues.set(streamId, queue);
      }
      queue.push(pcm);
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] || output[0];
    left.fill(0);
    if (right !== left) right.fill(0);

    this.queues.forEach((queue) => queue.mixInto(left, right));
    for (let frame = 0; frame < left.length; frame += 1) {
      left[frame] = Math.max(-1, Math.min(1, left[frame]));
      right[frame] = Math.max(-1, Math.min(1, right[frame]));
    }
    return true;
  }
}

registerProcessor("resenhazinha-pcm-mixer", ResenhazinhaPcmMixer);
