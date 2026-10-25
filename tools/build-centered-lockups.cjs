const sharp=require('sharp');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {resolve,join}=require('node:path');
const root=resolve(__dirname,'..'),out=join(root,'brand','telegram','centered');
mkdirSync(out,{recursive:true});
const mark=readFileSync(join(root,'public','logo.svg'),'utf8').replace(/<svg[^>]*>/,'').replace('</svg>','');
const logo=(cx,cy,h)=>`<g transform="translate(${cx-h/420*168},${cy-h/2}) scale(${h/420})">${mark}</g>`;
const svg=(w,h,content)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Colors VPN"><rect width="${w}" height="${h}" fill="#101316"/>${content}</svg>`;
(async()=>{
 const vertical=logo(800,706,480)+'<text x="800" y="1120" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="110" font-weight="550" letter-spacing="-3" fill="#f3f5f4">Colors<tspan dx="28" fill="#a1aaa9" font-weight="400">VPN</tspan></text>';
 const horizontal=logo(454,500,248)+'<text x="644" y="548" font-family="Segoe UI,Arial,sans-serif" font-size="122" font-weight="550" letter-spacing="-3" fill="#f3f5f4">Colors<tspan dx="28" fill="#a1aaa9" font-weight="400">VPN</tspan></text>';
 for(const [name,w,h,content]of[['10-centered-square',1600,1600,vertical],['11-centered-landscape',1920,1080,`<g transform="translate(160,40)">${horizontal}</g>`]]){
  const {data,info}=await sharp(Buffer.from(svg(w,h,content))).raw().toBuffer({resolveWithObject:true});
  let minX=w,minY=h,maxX=0,maxY=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*info.channels;if(Math.abs(data[i]-16)+Math.abs(data[i+1]-19)+Math.abs(data[i+2]-22)>32){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
  const dx=(w-1-minX-maxX)/2,dy=(h-1-minY-maxY)/2;
  const xml=svg(w,h,`<g transform="translate(${dx},${dy})">${content}</g>`);writeFileSync(join(out,name+'.svg'),xml);await sharp(Buffer.from(xml)).png().toFile(join(out,name+'.png'));
 }
 console.log('Exported square and landscape Colors VPN lockups.');
})().catch(e=>{console.error(e);process.exit(1);});
