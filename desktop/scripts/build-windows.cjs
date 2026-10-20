'use strict';
// Cross-build helper for the pinned electron-builder. NSIS uninstaller extraction
// uses its own reader (also used on macOS) instead of executing Windows code.
const fs=require('node:fs'),path=require('node:path');
process.chdir(path.join(__dirname,'..'));
const arch=process.argv.includes('--arm64')?'arm64':'x64';
if(process.argv.slice(2).some(a=>!['--x64','--arm64','--prepackaged'].includes(a)))throw Error('Use --x64 or --arm64');
if(require('electron-builder/package.json').version!=='26.15.3')throw Error('Review the cross-build adapter before updating electron-builder');
if(process.platform!=='win32'){
 const {WineVmManager}=require('app-builder-lib/out/vm/WineVm');
 const {UninstallerReader}=require('app-builder-lib/out/targets/nsis/nsisUtil');
 WineVmManager.prototype.exec=async function(file,args=[],options={}){
  if(options.env?.__COMPAT_LAYER!=='RunAsInvoker'||args.length||!/^FlowDesk-Setup-[\w.-]+-win-(x64|arm64)\.exe$/.test(path.basename(file))||fs.statSync(file).size>5*1024*1024)throw Error('Unexpected executable request during NSIS cross-build');
  const target=path.join(path.dirname(file),`${path.basename(file,'exe')}__uninstaller.exe`);
  await UninstallerReader.exec(file,target);
 };
}
const {build,Platform,Arch}=require('electron-builder');
build({targets:Platform.WINDOWS.createTarget(['nsis'],Arch[arch]),prepackaged:process.argv.includes('--prepackaged')?path.resolve('dist',arch==='arm64'?'win-arm64-unpacked':'win-unpacked'):undefined,publish:'never',config:{win:{signExecutable:false}}}).catch(e=>{console.error(e.message);process.exit(1)});
