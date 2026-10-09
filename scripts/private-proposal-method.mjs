import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readMethodCandidate,methodPreview,importPrivateMethod,methodDigest} from '../backend/proposal-methods.mjs';
// Local operator CLI: preview/import only. It cannot approve or activate a method.
export function privateMethodCLI(args){
 const [command,workspace,filename,expectedHash]=args;
 if(!['preview','import'].includes(command)||!workspace||!filename||args.length>(command==='preview'?3:4))throw Error('Use preview/import with explicit workspace, private JSON file and digest for import.');
 const candidate=readMethodCandidate(path.resolve(filename));
 if(command==='preview')return methodPreview(candidate);
 if(!expectedHash||expectedHash!==methodDigest(candidate))throw Error('Confirm the preview digest before importing.');
 return importPrivateMethod({workspace:path.resolve(workspace),candidate,expectedHash});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(privateMethodCLI(process.argv.slice(2))));}catch{console.error('Private method operation refused. Check schema, ignored destination, immutable version and confirmed digest. Nothing was approved or activated.');process.exitCode=1;}
}
