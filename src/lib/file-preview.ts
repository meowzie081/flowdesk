/** Only non-scriptable raster formats and actual PDF signatures are previewed. */
export function previewType(bytes:Uint8Array):string|null{
 const ascii=(start:number,end:number)=>String.fromCharCode(...bytes.slice(start,end));
 if(bytes.length>=8&&bytes[0]===137&&ascii(1,4)==='PNG'&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10)return 'image/png';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(['GIF87a','GIF89a'].includes(ascii(0,6)))return 'image/gif';
 if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return 'image/webp';
 if(ascii(0,5)==='%PDF-')return 'application/pdf';
 return null;
}
