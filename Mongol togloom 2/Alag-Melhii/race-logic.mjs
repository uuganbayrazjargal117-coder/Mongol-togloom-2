export function advance(horse,faces,length){
 const horses=faces.filter(x=>x===0).length;
 const different=new Set(faces).size===4;
 const steps=different?4:horses;
 return {horses,different,steps,position:Math.min(length,horse.position+steps)};
}
