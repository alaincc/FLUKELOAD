# Base de conocimiento: Fluke 1742/1746/1748

Esta guía resume los puntos del manual oficial que sí afectan cómo debemos interpretar datos y redactar reportes en este proyecto.

Fuentes base:
- `Manual/174xESP.pdf`
- `Manual/174xENG.pdf`
- Extracción de texto: `Manual/174xESP.txt`, `Manual/174xENG.txt`

## Alcance

El manual corresponde a los `Fluke 1742/1746/1748 Power Quality Logger`. El equipo puede registrar hasta 500 parámetros y el software `Energy Analyze Plus` se usa para configurar campañas, descargar sesiones, analizar armónicos/eventos y generar informes.

## Regla principal para interpretar datasets

No todos los parámetros pertenecen a la misma resolución temporal ni al mismo tipo de estudio. Para cualquier análisis o reporte debemos identificar primero:

1. Tipo de estudio: `Energy Study` o `Load Study`.
2. Intervalo real del dato: `Trend`, `Demand`, `PQ/CE 10 min`, `150/180 cycles`, o `event-triggered`.
3. Si había licencia `IEEE 519/Report`.
4. Si un valor es medido, calculado, simulado o no disponible en ese modo.

## Tipos de estudio

### Energy Study

Usar esta interpretación cuando hay medición de tensión real y se quieren evaluar:
- potencia activa
- factor de potencia
- energía
- calidad de energía
- eventos de tensión/corriente

### Load Study

Usar esta interpretación cuando el objetivo principal es corriente/carga del circuito y no necesariamente hay tensión medida.

Implicaciones importantes:
- algunos valores de potencia aparente pueden ser `simulados` si se configuró `Unom`
- varios parámetros avanzados no están disponibles en `Load Study`
- el manual marca algunos valores como `Not available in load studies`

Conclusión práctica:
En reportes de `Load Study`, no debemos presentar variables avanzadas como si fueran equivalentes a un estudio completo de calidad de energía, salvo que el dataset confirme que fueron medidas y no simuladas.

## Intervalos y agregaciones

### Trend interval

Rango configurable: `1 s` a `30 min`.

Aquí viven normalmente:
- tensión
- corriente
- auxiliar
- frecuencia
- THD V
- THD A
- potencia
- energía
- factor de potencia
- potencia fundamental
- DPF
- desequilibrio

Interpretación:
- este es el intervalo principal para tendencias operativas
- sirve para carga, comportamiento horario, demanda y estabilidad general
- no equivale a una evaluación normativa completa de PQ

### Demand interval

Rango configurable: `5 min` a `30 min`.

Aquí aparecen típicamente:
- energía
- factor de potencia
- demanda máxima
- costo de energía

Interpretación:
- usar para demanda y consumo agregado
- no mezclar directamente con picos instantáneos de tendencia o eventos

### PQ/CE interval

Ventana típica: `10 min`.

Aquí se evalúan:
- tensión
- frecuencia
- desequilibrio
- armónicos
- interarmónicos
- flicker `Pst`
- flicker `Plt` con agregación deslizante de `2 h`

Interpretación:
- esta es la base adecuada para afirmaciones de calidad de energía
- si el reporte habla de cumplimiento o desvíos de PQ, debe apoyarse en estas ventanas

### 150/180 cycles

Ventana típica: alrededor de `3 s` a 50/60 Hz.

Se usa para:
- armónicos de tensión
- armónicos de corriente
- THD
- TDD
- señalización de red

Interpretación:
- útil para análisis armónico más fino
- no debe confundirse con valores trend ni con resúmenes de 10 minutos

### Event-triggered recordings

Cuando hay evento, el equipo puede guardar:
- snapshot de forma de onda
- perfil RMS
- señalización de red

Interpretación:
- estos registros explican anomalías puntuales
- no representan el comportamiento promedio de toda la campaña

## Regla crítica de sincronización temporal

El manual indica que los datos de calidad eléctrica usados para gráficos PQ, armónicos y evaluación normalizada se sincronizan con el reloj y se inician/cierran en fronteras de `10 min`.

Ejemplo del manual:
- una sesión de `09:05` a `09:35` contiene intervalos PQ completos de `09:10-09:20` y `09:20-09:30`

Conclusión práctica:
- no debemos asumir que el primer y último tramo de una campaña contienen bloques PQ completos
- si faltan ventanas al inicio o al final, puede ser normal por alineación temporal

## Verificación de conexiones

El manual da mucho peso a la `Connection Verification`. La verificación detecta:
- señal demasiado baja
- rotación de fases
- inversión de sondas de corriente
- mapeo de fases incorrecto

Conclusión práctica:
- si vemos potencias negativas inesperadas, secuencia de fases rara o corrientes/tensiones que no casan, antes de concluir un problema del sistema debemos considerar un posible error de conexión
- la corrección automática ayuda, pero el propio manual advierte que no detecta todo
- en aplicaciones con generación monofásica, la autocorrección puede dar resultados erróneos

## Definiciones operativas para reportes

### THD

`THD` es la distorsión armónica total:
- porcentaje RMS de la suma de armónicos `h02...h50`
- referida al componente fundamental `h01`

Uso en reportes:
- describirla como distorsión relativa respecto a la fundamental
- no como magnitud absoluta de corriente o tensión

### THC

`THC` es el contenido armónico total:
- valor RMS absoluto de la suma de armónicos

Uso en reportes:
- útil cuando importa la magnitud real, no solo el porcentaje

### TID y TIC

- `TID`: distorsión interarmónica total
- `TIC`: contenido total de interarmónicos

Uso en reportes:
- tratarlos separados de THD/THC
- no mezclar interarmónicos con armónicos clásicos

### TDD

`TDD` es distorsión total de demanda:
- porcentaje RMS de armónicos de corriente `h02...h50`
- referido a `IL`, la corriente máxima de demanda

Implicaciones:
- no es lo mismo que `THD A`
- requiere contexto IEEE 519
- depende de que `IL` esté bien definido en configuración

Regla de reporte:
- si no sabemos cómo se configuró `IL`, conviene ser prudentes al sacar conclusiones normativas de `TDD`

### Unbalance / desequilibrio

El manual define el desequilibrio como relación entre secuencia negativa y positiva.

Interpretación:
- valores bajos pueden ser normales
- el propio manual indica que típicamente está en el rango `0 % a 2 %`

### Pst y Plt

- `Pst`: flicker de corto plazo en periodos de `10 min`
- `Plt`: flicker de largo plazo en periodos de `2 h`

Regla de reporte:
- `Plt` no debe interpretarse como instantáneo
- si la campaña es corta, puede haber menos contexto para `Plt`

## Licencia IEEE 519/Report

La licencia `IEEE 519/Report` activa:
- almacenamiento armónico de `150/180 cycles`
- evaluación de armónicos y tensión baja/muy baja
- análisis `pass/fail` en Energy Analyze Plus
- generación de informes
- cálculo y validación de `TDD`

Conclusión práctica:
- si un dataset o exportación no tiene estas funciones, no debemos asumir que faltan por error; puede ser una limitación de licencia o modelo

## Métricas y afirmaciones que sí conviene separar en los reportes

### Operación y carga

Usar aquí:
- corriente
- potencia
- energía
- demanda
- factor de potencia

### Calidad de energía

Usar aquí:
- tensión fuera de rango
- desequilibrio
- THD
- interarmónicos
- flicker
- eventos

### Eventos y anomalías

Usar aquí:
- dips
- swells
- interruptions
- rapid voltage change
- waveform deviation
- inrush

Regla:
- un evento aislado no debe describirse como comportamiento permanente
- una media de tendencia no debe borrar la gravedad de un evento puntual

## Cautelas para interpretar exportaciones del proyecto

Cuando procesemos archivos de este repo:

- si la sesión es `Load Study`, tratar potencia aparente o algunos derivados como potencialmente simulados
- si el resumen usa máximos, identificar si provienen de `Trend`, `Demand` o `Event`
- no comparar directamente un `THD` de 3 s con promedios de 10 min sin aclararlo
- para juicios normativos, priorizar ventanas `PQ/CE 10 min`
- para picos de arranque o anomalías breves, priorizar `event-triggered recordings`
- si el comportamiento parece físicamente incoherente, revisar primero posibilidad de inversión de fases/polaridad

## Cómo usar esta base en adelante

En este proyecto, salvo que un dataset indique otra cosa, voy a interpretar los reportes con estas reglas:

1. Separar claramente `carga/consumo` de `calidad de energía`.
2. Indicar siempre el intervalo temporal implícito cuando hable de una métrica.
3. Tratar `THD` y `TDD` como métricas distintas.
4. No presentar valores simulados de `Load Study` como mediciones directas.
5. Dar más peso a eventos y ventanas PQ cuando el objetivo sea diagnosticar calidad eléctrica.

## Referencias rápidas del manual

Puntos especialmente útiles del manual oficial:
- Introducción y tipos de registro: página 1
- Primeras mediciones y configuración típica: páginas 18-20
- Tipos de estudio y topologías: página 21 en adelante
- Configuración de eventos: alrededor de página 29
- Configuración de sesión y verificación de conexión: páginas 34-36
- Licencia `IEEE 519/Report`: página 41
- Glosario de métricas: página 45
- Tabla de parámetros compatibles: páginas 46-53 aprox.
