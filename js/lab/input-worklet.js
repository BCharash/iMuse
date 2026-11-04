// Analysis tap only: never monitor microphone audio through the speakers.
class LabInputProcessor extends AudioWorkletProcessor {
 constructor(){super();this.samples=new Float32Array(1024);this.position=0;}
 process(inputs,outputs) {
  for(const output of outputs)for(const channel of output)channel.fill(0);
  const input=inputs[0]?.[0];if(!input)return true;
  let offset=0;
  while(offset<input.length){const count=Math.min(input.length-offset,this.samples.length-this.position);
   this.samples.set(input.subarray(offset,offset+count),this.position);this.position+=count;offset+=count;
   if(this.position===this.samples.length){const pcm=this.samples;this.samples=new Float32Array(1024);this.position=0;this.port.postMessage(pcm,[pcm.buffer]);}
  }
  return true;
 }
}
registerProcessor('imuse-lab-input',LabInputProcessor);
