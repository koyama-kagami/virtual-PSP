/** Same-origin control plane, WebRTC video and bounded, ordered controller state. */
export function waitForVideo(video, signal, timeoutMs=15000) {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);video.removeEventListener?.('loadeddata',loaded);signal?.removeEventListener('abort',aborted);error?reject(error):resolve();};
    const loaded=()=>finish(), aborted=()=>finish(new DOMException('Session cancelled','AbortError'));
    const timer=setTimeout(()=>finish(new Error('已连接 PSP，但未收到画面')),timeoutMs);
    if(signal?.aborted) {aborted();return;}
    signal?.addEventListener('abort',aborted,{once:true});
    video.addEventListener?.('loadeddata',loaded,{once:true});
    // play() can remain pending forever before the first frame; the deadline covers it too.
    Promise.resolve(video.play()).then(()=>{if(video.readyState>=2)finish();},finish);
  });
}
export function createRuntimeClient({ video, fetchImpl = globalThis.fetch.bind(globalThis), PeerConnection = globalThis.RTCPeerConnection, pollMs = 2000 }) {
  const listeners = new Set(), reasons = new Set();
  let token, peer, channel, generation = 0, signal, epoch = 0, sequence = 0;
  let heartbeat, poll, ready = false, pausing = Promise.resolve(), cleanup = Promise.resolve();
  const inputQueue=[];
  const emit = event => { for (const fn of [...listeners]) fn(event); };
  const assertCurrent = id => { if (id !== generation || signal?.aborted) throw new DOMException('Session cancelled', 'AbortError'); };
  async function request(path, body, requestSignal = signal) {
    let response;
    try {
      const timeout = path === 'boot' ? 90000 : 25000;
      response = await fetchImpl('/runtime/' + path, {
        method: body === undefined ? 'GET' : 'POST', credentials:'same-origin', cache:'no-store',
        headers: body === undefined ? {} : {'Content-Type':'application/json'},
        body: body === undefined ? undefined : JSON.stringify({...body,token}),
        signal: requestSignal ? AbortSignal.any([requestSignal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
      });
    } catch (error) {
      if (requestSignal?.aborted) throw error;
      throw new Error('无法连接本地 PSP 服务，请运行 start-runtime.ps1 后重试。', {cause:error});
    }
    const result = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(result.error || `PSP 服务请求失败 (${response.status})`);
    return result;
  }
  function detach() {
    clearInterval(heartbeat); clearTimeout(poll); ready = false; inputQueue.length=0;
    if (channel) { channel.onopen=null; channel.onclose=null; channel.onmessage=null; channel.onbufferedamountlow=null; channel.close(); channel=null; }
    if (peer) { peer.onconnectionstatechange=null; peer.ontrack=null; peer.close(); peer=null; }
    video.pause?.(); video.srcObject=null;
  }
  function sendPending() {
    while (inputQueue.length && channel?.readyState === 'open' && channel.bufferedAmount <= 4096) {
      channel.send(JSON.stringify({type:'input',snapshot:inputQueue.shift()}));
    }
  }
  function controller(snapshot) {
    if (!channel || channel.readyState !== 'open') return;
    // Preserve button edges. Only adjacent axis-only changes may replace each other.
    const next={buttons:[...(snapshot.buttons??[])].sort(),x:snapshot.x??0,y:snapshot.y??0,sequence:++sequence,sessionEpoch:epoch};
    const last=inputQueue.at(-1);
    if(last && last.buttons.join(',')===next.buttons.join(',')) inputQueue[inputQueue.length-1]=next;
    else if(inputQueue.length>=32) { fail(new Error('PSP 按键传输拥塞，已释放输入，请重新连接'),generation); return; }
    else inputQueue.push(next);
    sendPending();
  }
  const neutral = () => controller({buttons:[],x:0,y:0});
  function stopRemote() {
    // A retry must await the old stop, otherwise its late arrival can stop the new session.
    cleanup=cleanup.catch(()=>{}).then(()=>token?request('stop',{},null):undefined);
    cleanup.catch(()=>{}); return cleanup;
  }
  function fail(error, id) {
    if (id !== generation) return;
    inputQueue.length=0; neutral(); detach(); ++generation; emit({type:'error',error});
    // The bridge also has a watchdog; this makes failure release prompt when HTTP survives.
    stopRemote();
  }
  async function monitor(id) {
    try {
      const result=await request('status'); if(id!==generation || !ready) return;
      if(result.status==='error') throw new Error(result.error || 'PSP 核心连接中断');
      if(['running','paused','off'].includes(result.status)) emit({type:'state',status:result.status});
    } catch(error) { if(id===generation && ready) fail(error,id); return; }
    poll=setTimeout(()=>monitor(id),pollMs);
  }
  return {
    subscribe(fn) { listeners.add(fn); return ()=>listeners.delete(fn); },
    async initialize(config, abortSignal) {
      detach(); const id=++generation; signal=abortSignal;
      await cleanup.catch(()=>{}); assertCurrent(id); reasons.clear(); sequence=0;
      epoch=Math.max(epoch+1,Date.now()); token=undefined;
      const result=await request('bootstrap'); assertCurrent(id); token=result.token;
      if(!token) throw new Error('本地 PSP 服务未返回会话凭据');
      return result.capabilities;
    },
    async boot() {
      const id=generation;
      try {
      await request('boot',{}); assertCurrent(id);
      if(!PeerConnection) throw new Error('当前浏览器不支持 WebRTC');
      const pc=peer=new PeerConnection({iceServers:[]}); pc.addTransceiver('video',{direction:'recvonly'});
      pc.ontrack=event=>{ if(id!==generation) return; video.srcObject=event.streams[0] || new MediaStream([event.track]); };
      const dc=channel=pc.createDataChannel('input',{ordered:true}); dc.bufferedAmountLowThreshold=1024;
      dc.onbufferedamountlow=sendPending;
      const connected=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>finish(new Error('PSP 视频连接超时，请重试')),20000);
        const abort=()=>finish(new DOMException('Session cancelled','AbortError'));
        const finish=error=>{ clearTimeout(timer); signal?.removeEventListener('abort',abort); error?reject(error):resolve(); };
        signal?.addEventListener('abort',abort,{once:true});
        dc.onopen=()=>{if(id!==generation) return; dc.send(JSON.stringify({type:'heartbeat'})); finish();};
        dc.onclose=()=>{ if(!ready) finish(new Error('PSP 控制连接已关闭')); else fail(new Error('PSP 控制连接中断'),id); };
      });
      // Attach a rejection handler before SDP work to avoid an unhandled timeout.
      connected.catch(()=>{});
        await pc.setLocalDescription(await pc.createOffer()); assertCurrent(id);
        if(pc.iceGatheringState!=='complete') await new Promise((resolve,reject)=>{
          const timeout=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',check); reject(new Error('本地媒体地址收集超时'));},8000);
          const check=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timeout);pc.removeEventListener('icegatheringstatechange',check);resolve();}};
          pc.addEventListener('icegatheringstatechange',check); check();
        });
        assertCurrent(id); const answer=await request('offer',{type:pc.localDescription.type,sdp:pc.localDescription.sdp}); assertCurrent(id);
        await pc.setRemoteDescription(answer); await connected; assertCurrent(id);
        await waitForVideo(video,signal);
        assertCurrent(id); ready=true;
        pc.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(pc.connectionState)) fail(new Error('PSP 视频连接中断'),id);};
        heartbeat=setInterval(()=>{if(dc.readyState==='open' && dc.bufferedAmount<4096){sendPending();dc.send(JSON.stringify({type:'heartbeat'}));}},1000);
        poll=setTimeout(()=>monitor(id),pollMs);
      } catch(error) { if(id===generation){detach(); await stopRemote().catch(()=>{});} throw error; }
    },
    setController:controller,
    setPaused(reason, paused) {
      paused?reasons.add(reason):reasons.delete(reason); if(paused) neutral();
      const id=generation;
      pausing=pausing.catch(()=>{}).then(()=>{assertCurrent(id);return request('pause',{paused:reasons.size>0});});
      return pausing;
    },
    command(command) { return request('command',{command}); },
    async close() {
      neutral(); ++generation; detach(); reasons.clear();
      if(token) { try {await stopRemote();} finally {token=undefined;} }
    },
  };
}
