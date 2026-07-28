# Automatización de catálogos

La hoja **Catalogo Maestro Multitienda v2** es la única fuente de productos,
descripciones, imágenes, precios y números de WhatsApp:

https://docs.google.com/spreadsheets/d/1GEyYfnsI1TD4jH0DKnbK6ADzcHdf5AVuCrwY-mgl9hs/edit

## Funcionamiento

1. GitHub revisa la hoja cada hora.
2. Solo publica filas de `Productos` con `ACTIVO = Sí` y `PUBLICAR = Sí`.
3. Usa los precios independientes de las columnas de LYU, QHATHU, SHOPIX y
   NOVA.
4. LYU muestra precio por unidad, mayor y caja. Las otras tiendas muestran
   unidad y mayor; no se les asigna precio de caja.
5. Actualiza los cuatro catálogos y guarda el cambio en GitHub.
6. Netlify vuelve a publicar cada sitio conectado al repositorio.

## Archivos generados

- `index.html`: IMPORTADORA LYU
- `qhathu/index.html`: QHATHU
- `shopix/index.html`: SHOPIX
- `nova/index.html`: NOVA MARKET

No se debe editar manualmente `const PRODUCTOS` en esos archivos. Los cambios
de catálogo se hacen en Google Sheets.

## Nuevos productos

Para publicar un producto nuevo se necesita:

- un ID único;
- nombre, categoría y descripción corta;
- un enlace HTTPS público a la imagen;
- precio unitario y mayor para las cuatro tiendas;
- precio de caja para LYU;
- `ACTIVO = Sí` y `PUBLICAR = Sí`.

Si falta un dato obligatorio, la automatización se detiene y conserva la última
versión correcta de los catálogos.

Cuando un precio mayorista supera al precio unitario, la automatización lo
informa como advertencia, pero respeta el valor escrito en la hoja y no modifica
decisiones comerciales por su cuenta.

## Ejecución manual

Desde GitHub se puede abrir **Actions → Sincronizar catálogos → Run workflow**
para actualizar inmediatamente sin esperar la siguiente revisión horaria.
