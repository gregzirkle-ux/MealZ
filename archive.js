'use strict';
// Standard ZIP (STORE method). JPEGs and DOCX are already compressed.
// Blob parts avoid building another full in-memory copy of all photo bytes.
const zipCRC = Uint32Array.from({length:256}, (_, n) => {
  let c=n; for(let k=0;k<8;k++) c=(c&1)?0xedb88320^(c>>>1):c>>>1; return c>>>0;
});
async function makeVisitZip(entries, name) {
  if(entries.length>65535) throw new Error('Too many files for one visit archive.');
  const local=[],central=[],names=new Set(),encoder=new TextEncoder(); let offset=0,centralSize=0;
  const now=new Date(),year=Math.max(1980,Math.min(2107,now.getFullYear()));
  const date=((year-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
  const time=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1);
  for(const entry of entries) {
    if(!entry.path || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').some(p=>p==='.'||p==='..') || names.has(entry.path)) throw new Error('Invalid archive filename.');
    names.add(entry.path);const filename=encoder.encode(entry.path),blob=entry.blob;
    if(filename.length>65535 || !blob || blob.size>=0xffffffff || offset+30+filename.length+blob.size>=0xffffffff) throw new Error('This archive is too large to package on this device.');
    const bytes=new Uint8Array(await blob.arrayBuffer());let crc=0xffffffff;
    for(const b of bytes)crc=zipCRC[(crc^b)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;
    const header=new Uint8Array(30),h=new DataView(header.buffer);
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);
    h.setUint16(10,time,true);h.setUint16(12,date,true);h.setUint32(14,crc,true);
    h.setUint32(18,blob.size,true);h.setUint32(22,blob.size,true);h.setUint16(26,filename.length,true);
    local.push(header,filename,blob);
    const record=new Uint8Array(46),c=new DataView(record.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);
    c.setUint16(12,time,true);c.setUint16(14,date,true);c.setUint32(16,crc,true);
    c.setUint32(20,blob.size,true);c.setUint32(24,blob.size,true);c.setUint16(28,filename.length,true);
    c.setUint32(38,entry.path.endsWith('/')?0x10:0,true);c.setUint32(42,offset,true);
    central.push(record,filename);centralSize+=record.length+filename.length;
    offset+=header.length+filename.length+blob.size;
  }
  if(offset+centralSize+22>=0xffffffff)throw new Error('This archive is too large to package on this device.');
  const end=new Uint8Array(22),e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);
  e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  return new File([...local,...central,end],name,{type:'application/zip'});
}
function visitArchiveEntries(folder,report,photos,index,recovery) {
  const entries=[{path:folder+'/',blob:new Blob()}];
  for(const dir of ['Report','Photos','Photo-Index','Recovery'])entries.push({path:folder+'/'+dir+'/',blob:new Blob()});
  for(const [dir,files] of [['Report',[report]],['Photos',photos],['Photo-Index',[index]],['Recovery',[recovery]]])
    for(const file of files) entries.push({path:folder+'/'+dir+'/'+file.name,blob:file});
  return entries;
}
