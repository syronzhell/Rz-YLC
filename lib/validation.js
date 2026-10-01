import {Fault} from './security.js';
export function uuid(value){if(typeof value!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new Fault('ID permintaan tidak valid.');return value;}
export function validConfig(raw){
  if(!raw||! /^[a-zA-Z0-9_-]{11}$/.test(raw.video_id||''))throw new Fault('Pilih live aktif.');
  if(!Array.isArray(raw.titles)||raw.titles.length<1||raw.titles.length>500)throw new Fault('Isi 1–500 judul.');
  const titles=raw.titles.map(x=>{if(typeof x!=='string')throw new Fault('Judul harus teks.');const t=x.trim();if(!t||[...t].length>100||/[<>\x00-\x1f]/.test(t))throw new Fault('Judul wajib 1–100 karakter, satu baris, tanpa < atau >.');return t;});
  const interval_minutes=Number(raw.interval_minutes);
  if(!Number.isFinite(interval_minutes)||interval_minutes<10||interval_minutes>43200)throw new Fault('Interval minimal 10 menit dan maksimal 30 hari.');
  return {video_id:raw.video_id,titles,interval_minutes};
}
