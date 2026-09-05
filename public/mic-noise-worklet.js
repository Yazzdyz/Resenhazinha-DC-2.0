class ResenhazinhaNoiseGateProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const level = options?.processorOptions?.level === "high" ? "high" : "medium";
    this.threshold = level === "high" ? 0.011 : 0.0065;
    this.floor = level === "high" ? 0.08 : 0.28;
    this.gain = 1;
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
      for (let i = 0; i < source.length; i += 1) {
        sum += source[i] * source[i];
        count += 1;
      }
    }
    const rms = count ? Math.sqrt(sum / count) : 0;
    const target = rms >= this.threshold ? 1 : this.floor;
    const smoothing = target > this.gain ? 0.32 : 0.055;
    this.gain += (target - this.gain) * smoothing;
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
