// Production speech helpers. The resampler/context match the corrected lab contract.
export class SileroV5Context {
    constructor() { this.reset(); }
    reset() { this.samples = new Float32Array(64); }
    prepend(frame) {
        if (frame.length !== 512) throw Error('Silero requires 512 new samples');
        const input = new Float32Array(576);
        input.set(this.samples); input.set(frame, 64);
        this.samples = frame.slice(-64);
        return input;
    }
}

export function speechPolicyEnabled(settings, state) {
    return settings.audioCommands && (state === 'paused' ? settings.speechDuringPause === true
        : state === 'recording' && settings.speechDuringRecord === true);
}

export function speechDecision(result, settings) {
    // Loading/failure must not remove the existing wake/manual recording path.
    if (!result.available) return { pass: true, reason: result.reason, bypassed: true };
    const frames = result.history.filter(frame => frame.end <= result.end &&
        result.end - frame.end <= settings.speechLookbackMs * 16);
    const qualifying = frames.filter(frame => frame.prob >= settings.speechThreshold).length;
    return { pass: qualifying >= settings.speechMinFrames, qualifying,
        peak: frames.reduce((peak, frame) => Math.max(peak, frame.prob), 0),
        threshold: settings.speechThreshold, requiredFrames: settings.speechMinFrames,
        lookbackMs: settings.speechLookbackMs, reason: 'evaluated', bypassed: false };
}

// Streaming anti-alias resampling; retained across packets in one listening interval.
export class StreamingResampler {
 constructor(inputRate,outputRate=16000) {
  if(inputRate<outputRate)throw Error('Input sample rate is below the lab’s 16 kHz requirement');
  this.step=inputRate/outputRate;this.radius=32;this.buffer=new Float32Array(0);this.base=0;this.position=0;
  const cutoff=.44*outputRate/inputRate;
  this.kernels=Array.from({length:128},(_,phase)=>{
   const taps=new Float64Array(this.radius*2+1);let sum=0;
   for(let i=-this.radius;i<=this.radius;i++){const d=i-phase/128,angle=2*Math.PI*cutoff*d;
    const sinc=Math.abs(angle)<1e-12?1:Math.sin(angle)/angle;
    const weight=2*cutoff*sinc*(.5+.5*Math.cos(Math.PI*d/(this.radius+1)));taps[i+this.radius]=weight;sum+=weight;}
   for(let i=0;i<taps.length;i++)taps[i]/=sum;return taps;
  });
 }
 push(input) {
  const joined=new Float32Array(this.buffer.length+input.length);joined.set(this.buffer);joined.set(input,this.buffer.length);this.buffer=joined;
  const end=this.base+this.buffer.length,output=[];
  while(Math.floor(this.position)+this.radius<end){
   const center=Math.floor(this.position),fraction=this.position-center;
   const weights=this.kernels[Math.min(127,Math.floor(fraction*128))];let value=0;
   for(let tap=-this.radius;tap<=this.radius;tap++){const index=center+tap-this.base;if(index>=0)value+=this.buffer[index]*weights[tap+this.radius];}
   output.push(value);this.position+=this.step;
  }
  const remove=Math.max(0,Math.floor(this.position)-this.radius-this.base);
  if(remove){this.buffer=this.buffer.slice(remove);this.base+=remove;}
  return Float32Array.from(output);
 }
}
