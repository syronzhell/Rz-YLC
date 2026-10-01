import {randomUUID} from 'node:crypto';
import {start} from 'workflow/api';
import {config} from '../lib/security.js';
import {Database} from '../lib/database.js';
import {tick} from '../lib/engine.js';
import {titleLoop} from './loop.js';
export async function register(generation,ticket,owner){
  'use step';
  return new Database(config()).rpc('register',{generation,ticket,owner});
}
export async function advance(generation,owner){
  'use step';
  const settings=config();return tick(new Database(settings),settings,generation,owner);
}
export async function rollover(generation,owner){
  'use step';
  const result=await new Database(config()).rpc('rollover',{generation,owner},randomUUID());
  if(!result.stop)await start(titleLoop,[generation,result.ticket]);
  return {done:true};
}
