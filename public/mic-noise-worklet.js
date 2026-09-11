class ResenhazinhaNoiseGateProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.level = options?.processorOptions?.level === "high" ? "high" : "medium";
    const high = this.level === "high";
    this.noiseFloor = high ? 0.0045 : 0.0035;
    this.minimumOpen = high ? 0.020 : 0.011;
    this.openRatio = high ? 3.2 : 2.35;
    this.closeRatio = high ? 2.15 : 1.65;
    this.floorGain = high ? 0.008 : 0.09;
    this.gain = 1;
    this.holdBlocks = 0;
    this.holdLength = high ? 24 : 34;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input?.length || !output?.length) return true;
    const channels = Math.min(input.length, output.length);
    let sum = 0;
    let count = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const source = input[channel];
      for (let i = 0; i < source.length; i += 1) { sum += source[i] * source[i]; count += 1; }
    }
    const rms = count ? Math.sqrt(sum / count) : 0;

    // Aprende lentamente o ruído ambiente apenas nos trechos mais baixos.
    if (rms < Math.max(this.minimumOpen * 0.9, this.noiseFloor * 1.8)) {
      const learn = this.level === "high" ? 0.006 : 0.004;
      this.noiseFloor += (rms - this.noiseFloor) * learn;
      this.noiseFloor = Math.max(0.0008, Math.min(this.minimumOpen, this.noiseFloor));
    }

    const openThreshold = Math.max(this.minimumOpen, this.noiseFloor * this.openRatio);
    const closeThreshold = Math.max(this.minimumOpen * 0.62, this.noiseFloor * this.closeRatio);
    let target;
    if (rms >= openThreshold) {
      this.holdBlocks = this.holdLength;
      target = 1;
    } else if (this.holdBlocks > 0) {
      this.holdBlocks -= 1;
      target = 1;
    } else if (rms <= closeThreshold) {
      target = this.floorGain;
    } else {
      const span = Math.max(0.00001, openThreshold - closeThreshold);
      const blend = Math.max(0, Math.min(1, (rms - closeThreshold) / span));
      target = this.floorGain + (1 - this.floorGain) * blend;
    }

    const attack = this.level === "high" ? 0.62 : 0.48;
    const release = this.level === "high" ? 0.12 : 0.075;
    this.gain += (target - this.gain) * (target > this.gain ? attack : release);

    for (let channel = 0; channel < channels; channel += 1) {
      const source = input[channel];
      const destination = output[channel];
      for (let i = 0; i < source.length; i += 1) destination[i] = source[i] * this.gain;
    }
    for (let channel = channels; channel < output.length; channel += 1) output[channel].fill(0);
    return true;
  }
}

registerProcessor("resenhazinha-noise-gate", ResenhazinhaNoiseGateProcessor);
