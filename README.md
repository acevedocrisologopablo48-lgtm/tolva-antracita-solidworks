# Tolva de antracita

Visor interactivo de las geometrías de 900, 300 y 200 mm, exportadas de las piezas nativas de SOLIDWORKS. Los archivos originales están disponibles desde el visor.

## Descarga de una tonelada

Las mallas mantienen los cuerpos, las aristas y los colores del CAD, con coordenadas en metros y eje Z vertical. El material entra por el frente abierto desde la posición de vertido. La alimentación dura aproximadamente 1,35 s y la simulación abarca 8 s.

El motor del navegador calcula las 24 combinaciones de tres geometrías, granulometría de 0–3 y 0–6 mm, humedad de 5 y 9 % y densidad de grano de 1600 y 1800 kg/m³. Representa los 1000 kg con 1200 grupos de granos. El volumen sólido se obtiene a partir de la masa y la densidad de partícula. El contacto normal tiene restitución cero y la fricción disipa el movimiento tangencial. Las dos granulometrías y humedades modifican la resistencia y la cohesión efectivas del conjunto. Esos coeficientes son supuestos.

El balance muestra la masa vertida, en tránsito, descargada y derramada. La masa en tránsito incluye la parte del pulso que vuela hacia la boca. La descarga se contabiliza al cruzar el plano de salida del CAD. Se usa un paso de 1/120 s y se genera un cuadro cada 0,05 s. En cuatro pruebas al reducir el paso a la mitad, la masa descargada al final del ciclo varió entre 2,4 y 10,3 puntos porcentuales de la carga. Los tiempos y cantidades sirven para visualizar el movimiento. Estimar caudal o atascos exige ensayos y calibración con el material real.

Los CSV de la primera simulación de muestra dispersa siguen disponibles en `assets/data` como referencia del estudio inicial de SOLIDWORKS.

## Ejecución

Sitio estático sin compilación. Se sirve la raíz del repositorio mediante GitHub Pages o un servidor HTTP local. Three.js está incluido en vendor con su licencia.
