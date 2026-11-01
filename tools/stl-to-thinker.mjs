// Converts a scanned Thinker (binary STL, Z up, figure facing -X, standing on a round display base)
// into thinker.bin for index.html: base removed, turned into the game's figure frame (Y up, facing +Z,
// +X = the figure's left, metres at the statue's own scale), welded, ambient occlusion baked per vertex.
//   node tools/stl-to-thinker.mjs Sculpture.stl thinker.bin
// thinker.bin: 'THK1' | u32 verts | u32 tris | f32 lo[3] | f32 hi[3] | u16 pos[verts*3] (lo..hi) | u16 idx[tris*3] | u8 ao[verts]
import fs from 'node:fs';
const [src,dst]=process.argv.slice(2);if(!src||!dst){console.error('usage: node tools/stl-to-thinker.mjs in.stl out.bin');process.exit(1)}
const BASE_TOP=8;        // height of the display base in the STL (mm); everything at or below it is dropped
const S=.0127;           // mm -> figure units (the statue is ~1.36 tall, like the sculpted one)
const DZ=.17;            // the statue's middle sits a little forward of the pedestal centre

/* ---- read, drop the base, turn into the figure frame ---- */
const buf=fs.readFileSync(src);const n=buf.readUInt32LE(80);if(84+n*50!==buf.length)throw new Error('not a binary STL');
const tri=[];for(let i=0;i<n;i++){const t=[];let low=true;for(let v=0;v<3;v++){const o=84+i*50+12+v*12;const x=buf.readFloatLE(o),y=buf.readFloatLE(o+4),z=buf.readFloatLE(o+8);if(z>BASE_TOP+.05)low=false;t.push([-y,z-BASE_TOP,-x])}if(!low)tri.push(t)}
const lo0=[1e9,1e9,1e9],hi0=[-1e9,-1e9,-1e9];for(const t of tri)for(const p of t)for(let k=0;k<3;k++){lo0[k]=Math.min(lo0[k],p[k]);hi0[k]=Math.max(hi0[k],p[k])}
const off=[-(lo0[0]+hi0[0])/2,0,-(lo0[2]+hi0[2])/2];
/* ---- weld ---- */
const map=new Map(),P=[],I=new Uint32Array(tri.length*3);
tri.forEach((t,i)=>t.forEach((p,v)=>{const q=[(p[0]+off[0])*S,p[1]*S,(p[2]+off[2])*S+DZ];const key=p.map(c=>Math.round(c*1e4)).join(',');let id=map.get(key);if(id===undefined){id=P.length/3;P.push(...q);map.set(key,id)}I[i*3+v]=id}));
const nv=P.length/3,nt=I.length/3;if(nv>65535)throw new Error('too many vertices for u16 indices');
const lo=[1e9,1e9,1e9],hi=[-1e9,-1e9,-1e9];for(let i=0;i<nv;i++)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],P[i*3+k]);hi[k]=Math.max(hi[k],P[i*3+k])}
/* ---- vertex normals (area weighted) ---- */
const N=new Float64Array(nv*3);for(let t=0;t<nt;t++){const a=I[t*3]*3,b=I[t*3+1]*3,c=I[t*3+2]*3;const ux=P[b]-P[a],uy=P[b+1]-P[a+1],uz=P[b+2]-P[a+2],vx=P[c]-P[a],vy=P[c+1]-P[a+1],vz=P[c+2]-P[a+2];
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;for(const o of [a,b,c]){N[o]+=nx;N[o+1]+=ny;N[o+2]+=nz}}
for(let i=0;i<nv;i++){const l=Math.hypot(N[i*3],N[i*3+1],N[i*3+2])||1;N[i*3]/=l;N[i*3+1]/=l;N[i*3+2]/=l}
/* ---- uniform grid of triangles for ray casting ---- */
const CS=.015,G=[0,1,2].map(k=>Math.ceil((hi[k]-lo[k])/CS)+1);const cellOf=(x,k)=>Math.min(G[k]-1,Math.max(0,Math.floor((x-lo[k])/CS)));
const cnt=new Uint32Array(G[0]*G[1]*G[2]+1);const each=(t,f)=>{const r=[0,1,2].map(k=>{let a=1e9,b=-1e9;for(let v=0;v<3;v++){const x=P[I[t*3+v]*3+k];a=Math.min(a,x);b=Math.max(b,x)}return [cellOf(a,k),cellOf(b,k)]});
  for(let z=r[2][0];z<=r[2][1];z++)for(let y=r[1][0];y<=r[1][1];y++)for(let x=r[0][0];x<=r[0][1];x++)f(x+G[0]*(y+G[1]*z))};
for(let t=0;t<nt;t++)each(t,c=>cnt[c+1]++);for(let i=1;i<cnt.length;i++)cnt[i]+=cnt[i-1];const fill=cnt.slice(),cellTri=new Uint32Array(cnt[cnt.length-1]);for(let t=0;t<nt;t++)each(t,c=>cellTri[fill[c]++]=t);
const hitTri=(t,o,d)=>{const a=I[t*3]*3,b=I[t*3+1]*3,c=I[t*3+2]*3;const e1=[P[b]-P[a],P[b+1]-P[a+1],P[b+2]-P[a+2]],e2=[P[c]-P[a],P[c+1]-P[a+1],P[c+2]-P[a+2]];
  const p=[d[1]*e2[2]-d[2]*e2[1],d[2]*e2[0]-d[0]*e2[2],d[0]*e2[1]-d[1]*e2[0]];const det=e1[0]*p[0]+e1[1]*p[1]+e1[2]*p[2];if(Math.abs(det)<1e-12)return -1;const id=1/det;
  const s=[o[0]-P[a],o[1]-P[a+1],o[2]-P[a+2]];const u=(s[0]*p[0]+s[1]*p[1]+s[2]*p[2])*id;if(u<0||u>1)return -1;const q=[s[1]*e1[2]-s[2]*e1[1],s[2]*e1[0]-s[0]*e1[2],s[0]*e1[1]-s[1]*e1[0]];
  const v=(d[0]*q[0]+d[1]*q[1]+d[2]*q[2])*id;if(v<0||u+v>1)return -1;return (e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2])*id};
// nearest hit within tMax (grid walk), the pedestal top (y=0) included; -1 when the ray escapes
function cast(o,d,tMax){let best=d[1]<0?-o[1]/d[1]:1e9;if(best>tMax)best=1e9;
  const c=[0,1,2].map(k=>cellOf(o[k],k)),step=d.map(x=>x>0?1:-1),tD=d.map(x=>Math.abs(CS/(x||1e-12)));
  const tM=[0,1,2].map(k=>{const edge=lo[k]+(c[k]+(d[k]>0?1:0))*CS;return d[k]?(edge-o[k])/d[k]:1e9});let t0=0;
  while(t0<=Math.min(tMax,best)){const ci=c[0]+G[0]*(c[1]+G[1]*c[2]);for(let i=cnt[ci];i<cnt[ci+1];i++){const t=hitTri(cellTri[i],o,d);if(t>1e-5&&t<best)best=t}
    const k=tM[0]<tM[1]?(tM[0]<tM[2]?0:2):(tM[1]<tM[2]?1:2);t0=tM[k];c[k]+=step[k];tM[k]+=tD[k];if(c[k]<0||c[k]>=G[k])break}
  return best<=tMax?best:-1}
/* ---- ambient occlusion: cosine-weighted rays; near hits darken creases, far ones the hollows between limbs ---- */
const R=64,NEAR=.035,FAR=.24,ao=new Uint8Array(nv);const dirs=[];for(let i=0;i<R;i++){const u=(i+.5)/R,phi=i*2.39996323,r=Math.sqrt(u);dirs.push([r*Math.cos(phi),r*Math.sin(phi),Math.sqrt(1-u)])}
const t0=Date.now();
for(let i=0;i<nv;i++){const n0=[N[i*3],N[i*3+1],N[i*3+2]];const tx=Math.abs(n0[0])<.9?[1,0,0]:[0,1,0];let a=[n0[1]*tx[2]-n0[2]*tx[1],n0[2]*tx[0]-n0[0]*tx[2],n0[0]*tx[1]-n0[1]*tx[0]];const al=Math.hypot(...a);a=a.map(x=>x/al);
  const b=[n0[1]*a[2]-n0[2]*a[1],n0[2]*a[0]-n0[0]*a[2],n0[0]*a[1]-n0[1]*a[0]];const o=[P[i*3]+n0[0]*.002,P[i*3+1]+n0[1]*.002,P[i*3+2]+n0[2]*.002];let near=0,far=0;
  for(const [x,y,z] of dirs){const d=[a[0]*x+b[0]*y+n0[0]*z,a[1]*x+b[1]*y+n0[1]*z,a[2]*x+b[2]*y+n0[2]*z];const t=cast(o,d,FAR);if(t<0)continue;far+=1-t/FAR;if(t<NEAR)near+=1-t/NEAR}
  ao[i]=Math.round(255*Math.max(0,Math.min(1,1-.9*near/R-.75*far/R)))}
/* ---- write ---- */
const out=Buffer.alloc(4+8+24+nv*6+nt*6+nv);let o=0;out.write('THK1',0,'latin1');o=4;out.writeUInt32LE(nv,o);out.writeUInt32LE(nt,o+4);o+=8;
for(const v of [...lo,...hi]){out.writeFloatLE(v,o);o+=4}
for(let i=0;i<nv*3;i++){const k=i%3;out.writeUInt16LE(Math.round((P[i]-lo[k])/(hi[k]-lo[k])*65535),o);o+=2}
for(let i=0;i<nt*3;i++){out.writeUInt16LE(I[i],o);o+=2}
for(let i=0;i<nv;i++)out[o++]=ao[i];
fs.writeFileSync(dst,out);
let foot=[[1e9,-1e9],[1e9,-1e9]];for(let i=0;i<nv;i++)if(P[i*3+1]<.02){foot[0][0]=Math.min(foot[0][0],P[i*3]);foot[0][1]=Math.max(foot[0][1],P[i*3]);foot[1][0]=Math.min(foot[1][0],P[i*3+2]);foot[1][1]=Math.max(foot[1][1],P[i*3+2])}
const hist=new Array(10).fill(0);for(const a of ao)hist[Math.min(9,a/25.6|0)]++;
console.log(`${nv} verts, ${nt} tris, ${out.length} bytes, AO ${Date.now()-t0} ms`);
console.log('bbox',lo.map(x=>x.toFixed(3)).join(','),'..',hi.map(x=>x.toFixed(3)).join(','));
console.log('footprint x',foot[0].map(x=>x.toFixed(3)).join('..'),'z',foot[1].map(x=>x.toFixed(3)).join('..'));
console.log('ao histogram (0..1 in tenths):',hist.join(' '));
