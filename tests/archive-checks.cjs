const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const ctx={File,Blob,TextEncoder,Uint32Array,Uint8Array,DataView,Date,Set};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../archive.js'),'utf8'),ctx);
(async()=>{
const report=new File(['report-bytes'],'Report.docx'),photo=new File([Uint8Array.from([0,255,1,128,77])],'Photo-é.jpg'),index=new File(['Filename,Note\r\nPhoto-é.jpg,Test'],'Index.csv'),recovery=new File(['{"project":"Test"}'],'Recovery.json');
const entries=ctx.visitArchiveEntries('SVR-001',report,[photo],index,recovery);
assert.equal(entries.length,9);const zip=await ctx.makeVisitZip(entries,'SVR-001.zip');assert.equal(zip.type,'application/zip');
if(process.argv[2])fs.writeFileSync(process.argv[2],Buffer.from(await zip.arrayBuffer()));
await assert.rejects(ctx.makeVisitZip([{path:'../bad',blob:new Blob()}],'bad.zip'));
await assert.rejects(ctx.makeVisitZip([entries[0],entries[0]],'bad.zip'));
const empty=ctx.visitArchiveEntries('SVR-002',report,[],index,recovery);assert(empty.some(e=>e.path==='SVR-002/Photos/'));
console.log('PASS: archive structure, empty Photos folder, Unicode filenames, unsafe paths and duplicate entries.');
})().catch(e=>{console.error(e);process.exitCode=1});
