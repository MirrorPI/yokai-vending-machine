/** Never assign immutable caching to mutable names or authenticated data. */
export function cacheControlFor(key){
 if(key==='index.html'||key==='account-config.json')return 'no-store';
 if(key==='ads.txt')return 'no-cache';
 if(/^game-content\/[a-f0-9]{64}\.[a-z0-9]+$/.test(key)||/^shared-photos\/yokai_\d+-\w+-(forest|hill)-(portrait|full)-[a-f0-9]{16}\.png$/.test(key))return 'public,max-age=31536000,immutable';
 return 'public,max-age=86400';
}
