import {existsSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';

export default {
  name:'namat-hackathon-development-api',
  hooks:{'astro:server:setup':({server})=>{
    server.middlewares.use('/api/hackathon',async(req,res)=>{
      try {
        // This file is gitignored and read only on the server. Changes do not
        // require exposing a credential through public build variables.
        const local = new URL('../../.env.hackathon.local',import.meta.url);
        const env = {...process.env,...(existsSync(local) ? parseEnv(readFileSync(local,'utf8')) : {})};
        const {handleHackathonHttp}=await import('./server/http.mjs');
        await handleHackathonHttp(req,res,{env});
      } catch {
        res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(JSON.stringify({status:'unavailable',message:'The test database connection is not ready. Your questionnaire has not been confirmed as saved.'}));
      }
    });
  }},
};
