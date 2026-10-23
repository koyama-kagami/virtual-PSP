import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeClient, waitForVideo } from './runtime-client.js';

function harness({failBoot=false}={}) {
  const calls = [], sent = [], peers = [];
  class Peer {
    constructor() { peers.push(this); this.iceGatheringState = 'complete'; }
    addTransceiver() {}
    createDataChannel() { return this.channel = { readyState:'connecting', bufferedAmount:0, send:s=>sent.push(JSON.parse(s)), close() { this.readyState='closed'; } }; }
    async createOffer() { return {type:'offer',sdp:'test'}; }
    async setLocalDescription(value) { this.localDescription=value; }
    async setRemoteDescription() { this.channel.readyState='open'; this.channel.onopen?.(); }
    close() { this.closed=true; }
  }
  const fetchImpl = async (url, options = {}) => {
    const body = options.body && JSON.parse(options.body); calls.push([url,body]);
    if(failBoot && url.endsWith('/boot')) return {ok:false,status:503,json:async()=>({error:'boot timeout'})};
    return {ok:true,json:async()=>url.endsWith('bootstrap')?{token:'secret',capabilities:{originalVsh:true}}:url.endsWith('offer')?{type:'answer',sdp:'answer'}:{status:'running'}};
  };
  const video = {readyState:2,play:async()=>{},pause(){},srcObject:null};
  return {calls,sent,peers,client:createRuntimeClient({video,fetchImpl,PeerConnection:Peer,pollMs:60000})};
}
test('transport gives every start a new wire epoch and never reuses a closed peer',async()=>{
  const h=harness(), c=h.client;
  await c.initialize({},new AbortController().signal); await c.boot();
  c.setController({buttons:['cross'],x:.5,y:-.5,sequence:1,sessionEpoch:1});
  const first=h.sent.at(-1).snapshot;
  await c.close(); assert.equal(h.peers[0].closed,true);
  await c.initialize({},new AbortController().signal); await c.boot();
  c.setController({buttons:[],x:0,y:0,sequence:0,sessionEpoch:1});
  const next=h.sent.at(-1).snapshot;
  assert.ok(next.sessionEpoch>first.sessionEpoch); assert.ok(next.sequence>0);
  await c.close();
});
test('pause reasons reconcile and clear controller before pausing',async()=>{
  const h=harness(), c=h.client;
  await c.initialize({},new AbortController().signal); await c.boot();
  c.setController({buttons:['up'],x:1,y:0});
  await c.setPaused('power',true); await c.setPaused('visibility',true);
  await c.setPaused('power',false);
  assert.equal(h.calls.at(-1)[1].paused,true);
  assert.deepEqual(h.sent.at(-1).snapshot.buttons,[]);
  await c.setPaused('visibility',false); assert.equal(h.calls.at(-1)[1].paused,false);
  await c.close();
});
test('failed helper initialization has an actionable error and no peer',async()=>{
  const c=createRuntimeClient({video:{},fetchImpl:async()=>({ok:false,status:503,json:async()=>({error:'Local runtime is not running'})})});
  await assert.rejects(c.initialize({},new AbortController().signal),/Local runtime/);
  await c.close();
});
test('backpressure preserves button press and release edges in bounded order',async t=>{
  const h=harness(), c=h.client;
  t.after(()=>c.close());
  await c.initialize({},new AbortController().signal); await c.boot();
  const dc=h.peers[0].channel; dc.bufferedAmount=5000;
  c.setController({buttons:['cross'],x:0,y:0}); c.setController({buttons:[],x:0,y:0});
  dc.bufferedAmount=0; dc.onbufferedamountlow();
  const inputs=h.sent.filter(p=>p.type==='input');
  assert.deepEqual(inputs.map(p=>p.snapshot.buttons),[['cross'],[]]); await c.close();
});
test('first-frame deadline covers a play promise that never settles, and abort is immediate',async()=>{
  const video=new EventTarget(); video.readyState=0; video.play=()=>new Promise(()=>{});
  await assert.rejects(waitForVideo(video,undefined,10),/未收到画面/);
  const abort=new AbortController(), pending=waitForVideo(video,abort.signal,60000);
  abort.abort(); await assert.rejects(pending,{name:'AbortError'});
});
test('failed boot request still stops late native startup before allowing retry',async t=>{
  const h=harness({failBoot:true}); t.after(()=>h.client.close());
  await h.client.initialize({},new AbortController().signal);
  await assert.rejects(h.client.boot(),/boot timeout/);
  assert.ok(h.calls.some(([url])=>url.endsWith('/stop')));
});
