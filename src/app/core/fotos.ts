/** Fotos tomadas desde el celular: se reducen antes de subirlas */

/** Reduce la foto (lado mayor 1280 px, JPEG) para que suba rápido desde el celular */
export async function comprimirFoto(archivo: File, ladoMax = 1280, calidad = 0.8): Promise<Blob> {
  const imagen = await createImageBitmap(archivo);
  const escala = Math.min(1, ladoMax / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(imagen.width * escala);
  lienzo.height = Math.round(imagen.height * escala);
  const contexto = lienzo.getContext('2d')!;
  // JPEG no tiene transparencia: sin fondo, los píxeles transparentes salen negros
  contexto.fillStyle = '#ffffff';
  contexto.fillRect(0, 0, lienzo.width, lienzo.height);
  contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  imagen.close();
  return new Promise((resolver, rechazar) =>
    lienzo.toBlob((b) => (b ? resolver(b) : rechazar(new Error('No se pudo procesar la foto.'))), 'image/jpeg', calidad));
}
