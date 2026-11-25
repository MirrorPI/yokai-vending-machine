import { inflateSync } from 'node:zlib';
const signature=Buffer.from('89504e470d0a1a0a','hex');
function crc(bytes) { let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0; }
/** Canvas-compatible, non-interlaced PNG; validate chunks, CRC and decompressed scanlines. */
export function validatePng(base64,width,height) {
 if(typeof base64!=='string'||base64.length>349528||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new Error('Invalid PNG encoding or size');
 const bytes=Buffer.from(base64,'base64');if(bytes.length>262144||bytes.length<45||bytes.toString('base64')!==base64||!bytes.subarray(0,8).equals(signature))throw new Error('Invalid PNG signature or size');
 let at=8,header,ended=false,hadIdat=false,afterIdat=false,palette=false; const data=[];
 while(at<bytes.length){if(at+12>bytes.length)throw new Error('Truncated PNG');const len=bytes.readUInt32BE(at),end=at+12+len;if(end>bytes.length)throw new Error('Truncated PNG chunk');const type=bytes.toString('ascii',at+4,at+8),body=bytes.subarray(at+8,at+8+len);
 if(!/^[A-Za-z]{4}$/.test(type)||crc(bytes.subarray(at+4,end-4))!==bytes.readUInt32BE(end-4))throw new Error('Malformed PNG chunk');
 if(!header&&type!=='IHDR')throw new Error('PNG header missing');
 if(type==='IHDR'){if(header||len!==13)throw new Error('Invalid PNG header');header=body;}
 else if(type==='IDAT'){if(afterIdat)throw new Error('Noncontiguous PNG data');hadIdat=true;data.push(body);}
 else {if(hadIdat)afterIdat=true;if(type==='PLTE'){if(hadIdat||!len||len%3||len>768)throw new Error('Invalid palette');palette=true;}else if(type==='IEND'){if(len||!hadIdat||end!==bytes.length)throw new Error('Invalid PNG end');ended=true;}else if(type[0]===type[0].toUpperCase())throw new Error('Unknown critical PNG chunk');}
 at=end;
 }
 if(!header||!ended||header.readUInt32BE(0)!==width||header.readUInt32BE(4)!==height||header[10]||header[11]||header[12])throw new Error('PNG dimensions or format unsupported');
 const depth=header[8],color=header[9],channels={0:1,2:3,3:1,4:2,6:4}[color];const allowed={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
 if(!channels||!allowed[color].includes(depth)||(color===3&&!palette))throw new Error('Invalid PNG color format');
 const stride=Math.ceil(width*channels*depth/8)+1,expected=stride*height; const raw=inflateSync(Buffer.concat(data),{maxOutputLength:expected});
 if(raw.length!==expected)throw new Error('Invalid PNG pixel data');for(let y=0;y<height;y++)if(raw[y*stride]>4)throw new Error('Invalid PNG filter');return bytes;
}
