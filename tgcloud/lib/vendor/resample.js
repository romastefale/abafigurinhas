/* Gerado por vendor-src/build.mjs; não edite à mão. */

// node_modules/wave-resampler/lib/interpolator.js
var Interpolator = class {
  /**
   * @param {number} scaleFrom the length of the original array.
   * @param {number} scaleTo The length of the new array.
   * @param {?Object} details The extra configuration, if needed.
   */
  constructor(scaleFrom, scaleTo, details) {
    this.length_ = scaleFrom;
    this.scaleFactor_ = (scaleFrom - 1) / scaleTo;
    this.interpolate = this.cubic;
    if (details.method === "point") {
      this.interpolate = this.point;
    } else if (details.method === "linear") {
      this.interpolate = this.linear;
    } else if (details.method === "sinc") {
      this.interpolate = this.sinc;
    }
    this.tangentFactor_ = 1 - Math.max(0, Math.min(1, details.tension || 0));
    this.sincFilterSize_ = details.sincFilterSize || 1;
    this.kernel_ = sincKernel_(details.sincWindow || window_);
  }
  /**
   * @param {number} t The index to interpolate.
   * @param {Array|TypedArray} samples the original array.
   * @return {number} The interpolated value.
   */
  point(t, samples) {
    return this.getClippedInput_(Math.round(this.scaleFactor_ * t), samples);
  }
  /**
   * @param {number} t The index to interpolate.
   * @param {Array|TypedArray} samples the original array.
   * @return {number} The interpolated value.
   */
  linear(t, samples) {
    t = this.scaleFactor_ * t;
    let k = Math.floor(t);
    t -= k;
    return (1 - t) * this.getClippedInput_(k, samples) + t * this.getClippedInput_(k + 1, samples);
  }
  /**
   * @param {number} t The index to interpolate.
   * @param {Array|TypedArray} samples the original array.
   * @return {number} The interpolated value.
   */
  cubic(t, samples) {
    t = this.scaleFactor_ * t;
    let k = Math.floor(t);
    let m = [this.getTangent_(k, samples), this.getTangent_(k + 1, samples)];
    let p = [
      this.getClippedInput_(k, samples),
      this.getClippedInput_(k + 1, samples)
    ];
    t -= k;
    let t2 = t * t;
    let t3 = t * t2;
    return (2 * t3 - 3 * t2 + 1) * p[0] + (t3 - 2 * t2 + t) * m[0] + (-2 * t3 + 3 * t2) * p[1] + (t3 - t2) * m[1];
  }
  /**
   * @param {number} t The index to interpolate.
   * @param {Array|TypedArray} samples the original array.
   * @return {number} The interpolated value.
   */
  sinc(t, samples) {
    t = this.scaleFactor_ * t;
    let k = Math.floor(t);
    let ref = k - this.sincFilterSize_ + 1;
    let ref1 = k + this.sincFilterSize_;
    let sum = 0;
    for (let n = ref; n <= ref1; n++) {
      sum += this.kernel_(t - n) * this.getClippedInput_(n, samples);
    }
    return sum;
  }
  /**
   * @param {number} k The scaled index to interpolate.
   * @param {Array|TypedArray} samples the original array.
   * @return {number} The tangent.
   * @private
   */
  getTangent_(k, samples) {
    return this.tangentFactor_ * (this.getClippedInput_(k + 1, samples) - this.getClippedInput_(k - 1, samples)) / 2;
  }
  /**
   * @param {number} t The scaled index to interpolate.
   * @param {Array|TypedArray} samples the original array.
   * @return {number} The interpolated value.
   * @private
   */
  getClippedInput_(t, samples) {
    if (0 <= t && t < this.length_) {
      return samples[t];
    }
    return 0;
  }
};
function window_(x) {
  return Math.exp(-x / 2 * x / 2);
}
function sincKernel_(window) {
  return function(x) {
    return sinc_(x) * window(x);
  };
}
function sinc_(x) {
  if (x === 0) {
    return 1;
  }
  return Math.sin(Math.PI * x) / (Math.PI * x);
}

// node_modules/wave-resampler/lib/fir-lpf.js
var FIRLPF = class {
  /**
   * @param {number} order The order of the filter.
   * @param {number} sampleRate The sample rate.
   * @param {number} cutOff The cut off frequency.
   */
  constructor(order, sampleRate, cutOff) {
    let omega = 2 * Math.PI * cutOff / sampleRate;
    let dc = 0;
    this.filters = [];
    for (let i = 0; i <= order; i++) {
      if (i - order / 2 === 0) {
        this.filters[i] = omega;
      } else {
        this.filters[i] = Math.sin(omega * (i - order / 2)) / (i - order / 2);
        this.filters[i] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / order);
      }
      dc = dc + this.filters[i];
    }
    for (let i = 0; i <= order; i++) {
      this.filters[i] /= dc;
    }
    this.z = this.initZ_();
  }
  /**
   * @param {number} sample A sample of a sequence.
   * @return {number}
   */
  filter(sample) {
    this.z.buf[this.z.pointer] = sample;
    let out = 0;
    for (let i = 0, len = this.z.buf.length; i < len; i++) {
      out += this.filters[i] * this.z.buf[(this.z.pointer + i) % this.z.buf.length];
    }
    this.z.pointer = (this.z.pointer + 1) % this.z.buf.length;
    return out;
  }
  /**
   * Reset the filter.
   */
  reset() {
    this.z = this.initZ_();
  }
  /**
   * Return the default value for z.
   * @private
   */
  initZ_() {
    let r = [];
    for (let i = 0; i < this.filters.length - 1; i++) {
      r.push(0);
    }
    return {
      buf: r,
      pointer: 0
    };
  }
};

// node_modules/wave-resampler/lib/butterworth-lpf.js
var ButterworthLPF = class {
  /**
   * @param {number} order The order of the filter.
   * @param {number} sampleRate The sample rate.
   * @param {number} cutOff The cut off frequency.
   */
  constructor(order, sampleRate, cutOff) {
    let filters = [];
    for (let i = 0; i < order; i++) {
      filters.push(this.getCoeffs_({
        Fs: sampleRate,
        Fc: cutOff,
        Q: 0.5 / Math.sin(Math.PI / (order * 2) * (i + 0.5))
      }));
    }
    this.stages = [];
    for (let i = 0; i < filters.length; i++) {
      this.stages[i] = {
        b0: filters[i].b[0],
        b1: filters[i].b[1],
        b2: filters[i].b[2],
        a1: filters[i].a[0],
        a2: filters[i].a[1],
        k: filters[i].k,
        z: [0, 0]
      };
    }
  }
  /**
   * @param {number} sample A sample of a sequence.
   * @return {number}
   */
  filter(sample) {
    let out = sample;
    for (let i = 0, len = this.stages.length; i < len; i++) {
      out = this.runStage_(i, out);
    }
    return out;
  }
  getCoeffs_(params) {
    let coeffs = {};
    coeffs.z = [0, 0];
    coeffs.a = [];
    coeffs.b = [];
    let p = this.preCalc_(params, coeffs);
    coeffs.k = 1;
    coeffs.b.push((1 - p.cw) / (2 * p.a0));
    coeffs.b.push(2 * coeffs.b[0]);
    coeffs.b.push(coeffs.b[0]);
    return coeffs;
  }
  preCalc_(params, coeffs) {
    let pre = {};
    let w = 2 * Math.PI * params.Fc / params.Fs;
    pre.alpha = Math.sin(w) / (2 * params.Q);
    pre.cw = Math.cos(w);
    pre.a0 = 1 + pre.alpha;
    coeffs.a0 = pre.a0;
    coeffs.a.push(-2 * pre.cw / pre.a0);
    coeffs.k = 1;
    coeffs.a.push((1 - pre.alpha) / pre.a0);
    return pre;
  }
  runStage_(i, input) {
    let temp = input * this.stages[i].k - this.stages[i].a1 * this.stages[i].z[0] - this.stages[i].a2 * this.stages[i].z[1];
    let out = this.stages[i].b0 * temp + this.stages[i].b1 * this.stages[i].z[0] + this.stages[i].b2 * this.stages[i].z[1];
    this.stages[i].z[1] = this.stages[i].z[0];
    this.stages[i].z[0] = temp;
    return out;
  }
  /**
   * Reset the filter.
   */
  reset() {
    for (let i = 0; i < this.stages.length; i++) {
      this.stages[i].z = [0, 0];
    }
  }
};

// node_modules/wave-resampler/index.js
var DEFAULT_LPF_USE = {
  "point": false,
  "linear": false,
  "cubic": true,
  "sinc": true
};
var DEFAULT_LPF_ORDER = {
  "IIR": 16,
  "FIR": 71
};
var DEFAULT_LPF = {
  "IIR": ButterworthLPF,
  "FIR": FIRLPF
};
function resample(samples, oldSampleRate, sampleRate, details = {}) {
  let rate = (sampleRate - oldSampleRate) / oldSampleRate + 1;
  let newSamples = new Float64Array(samples.length * rate);
  details.method = details.method || "cubic";
  let interpolator = new Interpolator(
    samples.length,
    newSamples.length,
    {
      method: details.method,
      tension: details.tension || 0,
      sincFilterSize: details.sincFilterSize || 6,
      sincWindow: details.sincWindow || void 0
    }
  );
  if (details.LPF === void 0) {
    details.LPF = DEFAULT_LPF_USE[details.method];
  }
  if (details.LPF) {
    details.LPFType = details.LPFType || "IIR";
    const LPF = DEFAULT_LPF[details.LPFType];
    if (sampleRate > oldSampleRate) {
      let filter = new LPF(
        details.LPFOrder || DEFAULT_LPF_ORDER[details.LPFType],
        sampleRate,
        oldSampleRate / 2
      );
      upsample_(
        samples,
        newSamples,
        interpolator,
        filter
      );
    } else {
      let filter = new LPF(
        details.LPFOrder || DEFAULT_LPF_ORDER[details.LPFType],
        oldSampleRate,
        sampleRate / 2
      );
      downsample_(
        samples,
        newSamples,
        interpolator,
        filter
      );
    }
  } else {
    resample_(samples, newSamples, interpolator);
  }
  return newSamples;
}
function resample_(samples, newSamples, interpolator) {
  for (let i = 0, len = newSamples.length; i < len; i++) {
    newSamples[i] = interpolator.interpolate(i, samples);
  }
}
function upsample_(samples, newSamples, interpolator, filter) {
  for (let i = 0, len = newSamples.length; i < len; i++) {
    newSamples[i] = filter.filter(interpolator.interpolate(i, samples));
  }
  filter.reset();
  for (let i = newSamples.length - 1; i >= 0; i--) {
    newSamples[i] = filter.filter(newSamples[i]);
  }
}
function downsample_(samples, newSamples, interpolator, filter) {
  for (let i = 0, len = samples.length; i < len; i++) {
    samples[i] = filter.filter(samples[i]);
  }
  filter.reset();
  for (let i = samples.length - 1; i >= 0; i--) {
    samples[i] = filter.filter(samples[i]);
  }
  resample_(samples, newSamples, interpolator);
}
export {
  resample
};
