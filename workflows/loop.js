import {sleep,getWorkflowMetadata} from 'workflow';
import {register,advance,rollover} from './steps.js';
export async function titleLoop(generation,ticket){
  'use workflow';
  const owner=getWorkflowMetadata().workflowRunId;
  if((await register(generation,ticket,owner)).stop)return;
  // Short bounded runs keep replay/event history small; child runs continue the same queue.
  for(let i=0;i<64;i++){
    const result=await advance(generation,owner);
    if(result.stop)return;
    await sleep(Math.max(1000,result.wait_ms||1000));
  }
  await rollover(generation,owner);
}
