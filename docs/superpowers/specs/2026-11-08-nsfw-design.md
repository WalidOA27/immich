# Detección NSFW en Immich (fork mínimo) — diseño

Fecha: 2026-11-08 · Base: Immich `v3.3.6` · Rama: `nsfw` en `WalidOA27/immich`

## Intención

Poder ver la biblioteca de Immich sin que aparezcan fotos NSFW cuando no se quiere. En la web habrá un
interruptor de 3 posiciones: **Mostrar** (como ahora) · **Difuminar** · **Ocultar**. Android vendrá después.

El usuario decide qué es NSFW eligiendo un umbral sobre una puntuación 0–1, después de probar el modelo
con sus propias fotos.

## Lo que es más importante: fork mínimo

El fork tiene que poder rebasarse sobre cada versión de Immich (sale una casi cada semana) con poco
esfuerzo. Cada decisión de abajo prioriza "menos líneas tocadas en código de Immich" sobre elegancia.

## Objetivos

1. Una cola nueva **NSFW Detection** en *Administración → Job Queues*, con los botones habituales
   (Missing / All), que puntúa cada foto.
2. La puntuación se guarda por foto y sobrevive a reinicios y actualizaciones.
3. Interruptor de 3 estados en la web que afecta a la línea de tiempo y a las vistas basadas en ella.
4. Umbral configurable sin recompilar.

## No-objetivos (v1)

- App Android (fase 2; los datos ya quedarán listos porque `asset_metadata` se sincroniza con el móvil).
- Ocultar/difuminar en resultados de búsqueda, mapa, recuerdos, enlaces compartidos y navegación dentro
  del visor a pantalla completa.
- Corregir a mano fotos concretas ("esta no es NSFW"). Queda abierto para una v2.
- Vídeos (no tienen embedding CLIP de imagen fiable; se saltan).

## Anti-objetivos (sería un fracaso aunque funcione)

- Modificar archivos originales, EXIF o sidecars XMP.
- Añadir migraciones propias a la base de datos: el Immich oficial no arrancaría si se vuelve a él.
- Tocar el contenedor de machine learning.
- Cambios grandes en código de Immich que conviertan cada actualización en un conflicto.

## Decisiones tomadas (del usuario)

- Fork en GitHub del usuario, probar primero en archD (el PC del usuario).
- Interruptor de 3 estados: izquierda Mostrar, centro Difuminar, derecha Ocultar.
- Guardar la puntuación en la tabla existente `asset_metadata` (no en tabla propia, no en etiquetas,
  no en EXIF).
- Modelo: el detector LAION basado en CLIP (puntuación 0–1), si las pruebas lo validan.

## Contexto verificado

- La instancia usa CLIP `ViT-B-32__openai` (por defecto). 33.823 embeddings de 512 dims, normalizados (L2 = 1).
- El ML principal corre en archD (`192.168.1.75:3003`), con el del homelab como respaldo.
- `asset_metadata(assetId, key, value jsonb, updateId, updatedAt)`, PK `(assetId, key)`, borrado en
  cascada, con auditoría para sync. Vacía hoy. Ya existe `AssetRepository.upsertMetadata`.
  La API pública acepta cualquier clave (`key: z.string()`).
- LAION publica `clip_autokeras_nsfw_b32` para ViT-B/32: Normalization → Dense 32 ReLU → Dense 32 ReLU →
  Dense 1 sigmoid (~18.500 parámetros, 82 KB). Los pesos se han extraído a numpy sin TensorFlow.
- Prueba en archD: 31.123 fotos puntuadas en 2 s de CPU. Distribución bimodal: 27.033 < 0,1; 1.316 > 0,9.
- La detección de duplicados es el patrón a copiar: job encadenado tras Smart Search que usa el embedding
  ya guardado sin llamar al ML (`duplicate.service.ts`, encadenado en `job.service.ts`).

## Diseño

### Modelo y cálculo (servidor, sin ML)

- Los pesos del cabezal LAION se guardan como un fichero de datos nuevo dentro del servidor
  (p. ej. `server/src/nsfw/laion-b32.json`, ~200 KB) y se calcula la puntuación en TypeScript: son tres
  multiplicaciones de matrices pequeñas.
- Entrada: el embedding de `smart_search` de la foto. Salida: número 0–1.
- Guarda de seguridad: si el modelo CLIP configurado no es ViT-B-32 (dimensión ≠ 512), el job se salta
  con un aviso en el log. Puntuar con embeddings de otro modelo daría basura.

### Almacenamiento

- `asset_metadata`, clave `nsfw`, valor `{ "score": 0.873, "model": "laion-clip-b32", "v": 1 }`.
- El umbral **no** se guarda por foto.
- Volver a Immich oficial: las filas se quedan sin efecto. Nada que deshacer.

### Job queue

- `QueueName.NsfwDetection = 'nsfwDetection'`; `JobName.AssetDetectNsfwQueueAll` y `JobName.AssetDetectNsfw`.
- Se encadena tras `SmartSearch` para cualquier origen (subida o reproceso), como hacen los duplicados.
- "Missing" = fotos con embedding y sin fila `nsfw` (o con `v` antiguo). "All" = recalcular todas.
- Aparece en el panel de Job Queues con su nombre, descripción y concurrencia configurable como el resto.

### Umbral

- Variable de entorno `IMMICH_NSFW_THRESHOLD` (por defecto: el que elija el usuario en las pruebas).
  Más tarde podría pasar a ajustes de administración si compensa el código extra.

### API

- La respuesta de buckets de la línea de tiempo añade una columna `isNsfw: boolean[]`, calculada en la
  consulta con el umbral (unión con `asset_metadata`).
- Los endpoints de buckets aceptan `withoutNsfw=true`; filtra igual que el filtro existente `isDuplicate`,
  tanto en el recuento de buckets como en su contenido, para que la línea de tiempo no quede con huecos.
- El SDK/OpenAPI generados se regeneran con las herramientas de Immich (no se editan a mano).

### Web

- Interruptor de 3 estados en la barra superior. Estado guardado por navegador (localStorage).
- Difuminar: las miniaturas con `isNsfw` llevan un desenfoque fuerte. Abrir la foto la muestra normal
  (abrirla ya es una decisión consciente).
- Ocultar: la línea de tiempo se recarga pidiendo `withoutNsfw=true`.
- Alcance: línea de tiempo principal y vistas que usan el mismo gestor de línea de tiempo (álbumes,
  favoritos, archivo, personas…).

### Despliegue

- La base es v3.3.6, así que desplegar el fork incluye actualizar el homelab de 3.0.3 a 3.3.6
  (copia de la base de datos antes).
- Solo cambia la imagen del servidor; la de ML sigue siendo la oficial.

## Pruebas

- Unitarias del cálculo: embeddings de ejemplo con puntuaciones esperadas sacadas de la implementación
  numpy de referencia.
- Unitarias del job (patrón de los tests de `duplicate.service`): salta sin embedding, salta vídeos,
  salta si el modelo CLIP no es B-32, guarda metadata.
- Prueba manual en archD con un Immich de prueba antes del homelab.

## Riesgos

- La referencia numpy no se ha contrastado con TensorFlow; se valida por observación sobre las fotos reales
  del usuario (visor local). Si fuese necesario, contrastar una vez en un contenedor TF desechable.
- Calidad del modelo desconocida en fotos personales. Si no basta, plan B: un modelo de imagen (open_nsfw o
  ViT de Falconsai) en el contenedor ML, que sí implica forkar el ML.
- Archivos generados (OpenAPI/SDK) producen conflictos en cada rebase: se regeneran, no se resuelven a mano.

## Lo que queda al implementador

- Ubicación exacta del fichero de pesos y del código de cálculo.
- Nombre y posición exacta del interruptor en la barra superior; iconos.
- Cómo publicar la imagen del servidor del fork (GitHub Actions → ghcr.io recomendado, por el disco lleno de archD).

## Pendiente del usuario

- Elegir el umbral con el visor local.
