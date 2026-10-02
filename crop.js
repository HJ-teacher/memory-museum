/* 로컬 Canvas만 사용하는 네 모서리 원근 보정. 원본은 저장 확정 전까지 보존합니다. */
window.MuseumCrop = (() => {
  const $ = id => document.getElementById(id), names = ['왼쪽 위','오른쪽 위','오른쪽 아래','왼쪽 아래'];
  let source, points, handles = [], drag = -1, previewTimer, resolveReview;
  const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
  function valid() {
    for (let i=0;i<4;i++) {
      const a=points[i],b=points[(i+1)%4],c=points[(i+2)%4];
      if ((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]) < 100 || distance(a,b)<20) return false;
    }
    return true;
  }
  function output(limit = 4096, async = false) {
    if (!valid()) return null;
    const w=(distance(points[0],points[1])+distance(points[2],points[3]))/2;
    const h=(distance(points[0],points[3])+distance(points[1],points[2]))/2;
    const scale=Math.min(1,limit/Math.max(w,h));
    return (async ? MuseumAdvanced.warpAsync : MuseumAdvanced.warp)(source,points,w*scale,h*scale);
  }
  function preview() {
    clearTimeout(previewTimer);
    const result=output(600), canvas=$('cropPreview'); $('cropSave').disabled=!result;
    if (!result) { $('cropHelp').textContent='점이 서로 교차하지 않도록 종이 모서리 순서대로 맞춰 주세요.'; return; }
    canvas.width=result.width; canvas.height=result.height; canvas.getContext('2d').drawImage(result,0,0);
  }
  function draw() {
    $('cropOutline').querySelector('polygon').setAttribute('points',points.map(p=>`${p[0]/source.width*100},${p[1]/source.height*100}`).join(' '));
    handles.forEach((button,i)=>{button.style.left=points[i][0]/source.width*100+'%';button.style.top=points[i][1]/source.height*100+'%';});
    $('cropSave').disabled=!valid(); clearTimeout(previewTimer); previewTimer=setTimeout(preview,120);
  }
  function place(i,x,y) {
    points[i]=[Math.max(0,Math.min(source.width-1,x)),Math.max(0,Math.min(source.height-1,y))]; draw();
  }
  function full() { points=[[0,0],[source.width-1,0],[source.width-1,source.height-1],[0,source.height-1]]; draw(); }
  function showSource() {
    const canvas=$('cropSource'); canvas.width=source.width; canvas.height=source.height;
    canvas.getContext('2d').drawImage(source,0,0);
    $('cropStage').style.aspectRatio=`${source.width}/${source.height}`;
    $('cropStage').style.maxWidth=`min(100%, ${source.width/source.height*(innerWidth<=760?38:52)}dvh)`;
  }
  function finish(value) {
    clearTimeout(previewTimer); const done=resolveReview; resolveReview=null;
    if ($('cropDialog').open) $('cropDialog').close(); done?.(value);
  }
  function review(input) {
    if(resolveReview) finish(null);
    source=input; points=MuseumAdvanced.detectPaper(source);
    $('cropHelp').textContent=points ? '종이를 찾았어요. 네 점을 확인하고 필요하면 끌어서 미세 조정해 주세요.' : '종이 경계를 확실하게 찾지 못했어요. 네 점을 종이 모서리로 끌어 주세요. 이미 잘린 작품은 전체 선택을 유지하세요.';
    handles.forEach(h=>h.remove()); handles=[];
    names.forEach((name,i)=>{
      const button=document.createElement('button'); button.type='button'; button.className='crop-handle'; button.textContent=String(i+1); button.setAttribute('aria-label',`${name} 모서리 · 방향키로 조절`);
      button.onpointerdown=e=>{e.preventDefault();drag=i;button.setPointerCapture(e.pointerId);};
      button.onpointermove=e=>{if(drag!==i)return;const r=$('cropStage').getBoundingClientRect();place(i,(e.clientX-r.left)/r.width*source.width,(e.clientY-r.top)/r.height*source.height);};
      button.onpointerup=()=>{drag=-1;preview();}; button.onlostpointercapture=()=>{drag=-1;};
      button.onkeydown=e=>{const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!delta)return;e.preventDefault();const step=e.shiftKey?10:2;place(i,points[i][0]+delta[0]*step,points[i][1]+delta[1]*step);};
      $('cropStage').append(button);handles.push(button);
    });
    showSource(); if(!points)full();else draw();preview();
    $('cropDialog').showModal();
    return new Promise(resolve=>{resolveReview=resolve;});
  }
  $('cropReset').onclick=full;
  $('cropRotate').onclick=()=>{
    const old=source, next=MuseumCapture.make(old.height,old.width),ctx=next.getContext('2d');ctx.translate(next.width,0);ctx.rotate(Math.PI/2);ctx.drawImage(old,0,0);
    points=[points[3],points[0],points[1],points[2]].map(([x,y])=>[old.height-1-y,x]);source=next;showSource();draw();preview();
  };
  $('cropSave').onclick=async()=>{ const review=resolveReview; $('cropSave').disabled=true; const result=await output(4096,true);if(resolveReview!==review)return;if(result)finish(result);else if(resolveReview)draw(); };
  $('cropCancel').onclick=()=>finish(null);
  $('cropDialog').addEventListener('cancel',e=>{e.preventDefault();finish(null);});
  $('cropDialog').addEventListener('close',()=>{if(resolveReview)finish(null);});
  window.addEventListener('resize',()=>{if(resolveReview) { showSource(); draw(); }});
  return {review};
})();

