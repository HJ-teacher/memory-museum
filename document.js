/* 밝은 종이를 찾는 경량 Canvas 보조 기능입니다. AI나 외부 서버는 사용하지 않습니다.
   어두운 바탕의 흰 종이에 적합하며, 확신이 없으면 null을 반환합니다. */
window.MuseumAdvanced = (() => {
  // Try multiple exposure levels and score every enclosed component, rather than
  // rejecting the whole image when the largest bright component is the background.
  function detectPaper(source) {
    const scale = Math.min(1, 480 / Math.max(source.width, source.height));
    const w = Math.round(source.width * scale), h = Math.round(source.height * scale);
    if (w < 30 || h < 30) return null;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(source, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data, lum = new Uint8Array(w*h), histogram = new Uint32Array(256);
    let total = 0;
    for (let i=0;i<lum.length;i++) { lum[i] = Math.round(data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114); histogram[lum[i]]++; total += lum[i]; }
    let count=0, sum=0, variance=0, otsu=128;
    for(let t=0;t<255;t++) { count+=histogram[t]; sum+=t*histogram[t]; if(!count || count===lum.length) continue; const delta=sum/count-(total-sum)/(lum.length-count), v=count*(lum.length-count)*delta*delta; if(v>variance){variance=v;otsu=t;} }
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const area=p=>Math.abs(p.reduce((s,a,i)=>s+a[0]*p[(i+1)%p.length][1]-a[1]*p[(i+1)%p.length][0],0))/2;
    function hull(points) {
      points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]); const lower=[],upper=[];
      for(const p of points){while(lower.length>1 && cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
      for(let i=points.length-1;i>=0;i--){const p=points[i];while(upper.length>1 && cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
      lower.pop();upper.pop();return lower.concat(upper);
    }
    let best=null;
    for(const threshold of new Set([otsu+1,90,120,150,175,195,215,235])) {
      const seen=new Uint8Array(w*h),queue=new Int32Array(w*h);
      for(let start=0;start<lum.length;start++) {
        if(seen[start] || lum[start]<threshold)continue;
        let read=0,end=1,touches=0;queue[0]=start;seen[start]=1;const boundary=[];
        while(read<end){const i=queue[read++],x=i%w,y=Math.floor(i/w);let edge=false;
          if(x===0||y===0||x===w-1||y===h-1)touches++;
          for(const n of [x?i-1:-1,x<w-1?i+1:-1,y?i-w:-1,y<h-1?i+w:-1]) {
            if(n<0||lum[n]<threshold){edge=true;continue;}if(!seen[n]){seen[n]=1;queue[end++]=n;}
          }
          if(edge)boundary.push([x,y]);
        }
        if(touches || end<w*h*.07 || boundary.length<4)continue;
        const p=hull(boundary), originalArea=area(p);
        while(p.length>4){let k=0,loss=Infinity;for(let i=0;i<p.length;i++){const a=Math.abs(cross(p[(i+p.length-1)%p.length],p[i],p[(i+1)%p.length]));if(a<loss){loss=a;k=i;}}p.splice(k,1);}
        if(p.length!==4)continue;
        const a=area(p);if(a<w*h*.10||a>w*h*.96||a/originalArea<.88||end/a<.35)continue;
        const lengths=p.map((v,i)=>Math.hypot(v[0]-p[(i+1)%4][0],v[1]-p[(i+1)%4][1]));
        if(Math.min(...lengths)<24||Math.min(...lengths)/Math.max(...lengths)<.22)continue;
        if(p.some((v,i)=>cross(v,p[(i+1)%4],p[(i+2)%4])<80))continue;
        // A paper boundary must have visible contrast on all four sides.
        let contrast=0, supported=0;
        for(let i=0;i<4;i++){const v=p[i],b=p[(i+1)%4],len=lengths[i],nx=-(b[1]-v[1])/len,ny=(b[0]-v[0])/len;let edgeSum=0;
          for(let j=1;j<=12;j++){const t=j/13,x=v[0]+(b[0]-v[0])*t,y=v[1]+(b[1]-v[1])*t;
            const sample=(x,y)=>lum[Math.max(0,Math.min(h-1,Math.round(y)))*w+Math.max(0,Math.min(w-1,Math.round(x)))];
            edgeSum+=sample(x+nx*3,y+ny*3)-sample(x-nx*3,y-ny*3);
          }
          edgeSum/=12;contrast+=edgeSum;if(edgeSum>9)supported++;
        }
        if(supported<4)continue;
        const score=a*Math.min(1,end/a)*(1+Math.min(contrast/4,80)/80);
        if(!best||score>best.score){const first=p.reduce((k,v,i)=>v[0]+v[1]<p[k][0]+p[k][1]?i:k,0);best={score,points:p.slice(first).concat(p.slice(0,first))};}
      }
    }
    return best ? best.points.map(([x,y])=>[x*source.width/w,y*source.height/h]) : null;
  }
  function documentCrop(source, qrLocation = null) {
    const p = detectPaper(source, qrLocation); if (!p) return null;
    const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
    return warp(source,p,(distance(p[0],p[1])+distance(p[2],p[3]))/2,(distance(p[0],p[3])+distance(p[1],p[2]))/2);
  }
  // 단위 사각형 → 종이 사각형의 투영 변환을 역매핑하여 원근을 보정합니다.
  function warp(source, p, width, height) {
    const scale = Math.min(1, 1600 / Math.max(width, height)), out = document.createElement('canvas');
    out.width = Math.round(width * scale); out.height = Math.round(height * scale);
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    const det = dx1 * dy2 - dx2 * dy1; if (Math.abs(det) < 1e-8) return null;
    const g = (dx3 * dy2 - dx2 * dy3) / det, h = (dx1 * dy3 - dx3 * dy1) / det;
    const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
    const input = source.getContext('2d').getImageData(0, 0, source.width, source.height).data, ctx = out.getContext('2d'), image = ctx.createImageData(out.width, out.height);
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
      const u = x / Math.max(1, out.width - 1), v = y / Math.max(1, out.height - 1), z = g * u + h * v + 1;
      const sx = Math.max(0, Math.min(source.width - 1.001, (a * u + b * v + x0) / z)), sy = Math.max(0, Math.min(source.height - 1.001, (d * u + e * v + y0) / z));
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy, pos = (y * out.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) { const i = (iy * source.width + ix) * 4 + channel; image.data[pos + channel] = input[i] * (1 - fx) * (1 - fy) + input[i + 4] * fx * (1 - fy) + input[i + source.width * 4] * (1 - fx) * fy + input[i + source.width * 4 + 4] * fx * fy; }
      image.data[pos + 3] = 255;
    }
    ctx.putImageData(image, 0, 0); return out;
  }
  function hideQR(canvas) {
    // Recognition is temporary metadata. Remove recognized exhibit markers from
    // the display copy only, using the nearby paper color (including shadows).
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    for(let attempt=0;attempt<6;attempt++) {
      const image=ctx.getImageData(0,0,canvas.width,canvas.height);
      const qr=window.jsQR?.(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'});
      if(!qr || !/^(CLASS-EXHIBIT|EXHIBIT-\d{2})$/.test(qr.data))break;
      const pts=['topLeftCorner','topRightCorner','bottomRightCorner','bottomLeftCorner'].map(k=>qr.location[k]);
      const cx=pts.reduce((s,p)=>s+p.x,0)/4,cy=pts.reduce((s,p)=>s+p.y,0)/4;
      const polygon=pts.map(p=>({x:cx+(p.x-cx)*1.12,y:cy+(p.y-cy)*1.12}));
      const samples=[[],[],[]];
      for(const p of polygon)for(let step=0;step<12;step++) {
        const x=Math.round(cx+(p.x-cx)*1.12+step%3-1),y=Math.round(cy+(p.y-cy)*1.12+Math.floor(step/3)-2);
        if(x<0||y<0||x>=canvas.width||y>=canvas.height)continue;
        const i=(y*canvas.width+x)*4;for(let c=0;c<3;c++)samples[c].push(image.data[i+c]);
      }
      const color=samples.map(values=>{values.sort((a,b)=>a-b);return values.length?values[Math.floor(values.length*.6)]:255;});
      ctx.fillStyle=`rgb(${color.join(',')})`;ctx.beginPath();polygon.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();
    }
  }
  function settingsUI(s) {
    document.getElementById('advancedSettings').innerHTML = '<label class="inline-label"><input id="settingDocument" type="checkbox">종이 자동 크롭·원근 보정</label><p class="small">종이를 찾으면 자동으로 잘라요. 경계가 불확실하면 네 모서리를 확인합니다. QR은 인식에만 사용해요. 종이 옆에 따로 놓으면 가장 깨끗해요.</p>';
    document.getElementById('settingDocument').checked = s.autoDocument !== false;
  }
  function settingsValues() { return { autoDocument: document.getElementById('settingDocument').checked, hideQR: true }; }
  return { documentCrop, detectPaper, warp, hideQR, settingsUI, settingsValues };
})();
