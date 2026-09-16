import express from 'express';
import {handleRoyalRangers,startAttendanceReminders} from './royal-rangers-runtime.js';
startAttendanceReminders();
export const royalRangersRouter=express.Router();
royalRangersRouter.use(express.raw({type:()=>true,limit:'2mb'}));
royalRangersRouter.use(async(req,res)=>{try{const headers=new Headers();for(const [k,v] of Object.entries(req.headers)){if(typeof v==='string'&&!['host','content-length','cf-connecting-ip'].includes(k))headers.set(k,v)}headers.set('cf-connecting-ip',req.ip||'unknown');const request=new Request('https://b2b-v8kb.onrender.com'+req.originalUrl,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:req.body?.length?req.body.toString('utf8'):undefined})});const response=await handleRoyalRangers(request);res.status(response.status);response.headers.forEach((v:string,k:string)=>{if(k.toLowerCase()!=='set-cookie')res.setHeader(k,v)});const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);res.send(Buffer.from(await response.arrayBuffer()))}catch{res.status(503).json({error:'Royal Rangers is temporarily unavailable. Please retry.'})}});
