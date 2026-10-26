export async function readQrImage(file: File): Promise<string> {
  if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>10*1024*1024) throw Error('Chọn ảnh PNG, JPG hoặc WebP dưới 10 MB.');
  const url=URL.createObjectURL(file);
  try {
    const image=new Image(); image.src=url; await image.decode();
    if(image.naturalWidth*image.naturalHeight>40000000) throw Error('Ảnh quá lớn, hãy chọn ảnh nhỏ hơn.');
    const scale=Math.min(1,2000/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas'); canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Thiết bị chưa đọc được ảnh.');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height), jsQR=(await import('jsqr')).default;
    const qr=jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'attemptBoth'});
    if(!qr)throw Error('Không thấy mã QR trong ảnh. Hãy chọn ảnh rõ mã hơn.');
    return qr.data;
  } finally {URL.revokeObjectURL(url);}
}
