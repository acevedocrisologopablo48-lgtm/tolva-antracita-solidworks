# Tolva de antracita

Visor interactivo de las geometrías de 900, 300 y 200 mm, exportadas de las piezas nativas de SOLIDWORKS. Los archivos originales están disponibles desde el visor.

## Descarga de una tonelada

Las mallas conservan las aristas y los colores del CAD, con coordenadas en metros y eje Z vertical. La entrada sin alerón y la pared modificada están en el mismo extremo, X positivo. El embudo tiene cuatro paños. En las propuestas, cada lateral alabeado es una superficie reglada continua de 9,525 mm de espesor. La alimentación dura aproximadamente 1,35 s y la simulación abarca 8 s.

El motor del navegador calcula las 24 combinaciones de tres geometrías, granulometría de 0–3 y 0–6 mm, humedad de 5 y 9 % y densidad de grano de 1600 y 1800 kg/m³. Representa los 1000 kg con 1200 grupos de granos. El volumen sólido se obtiene a partir de la masa y la densidad de partícula. El contacto normal tiene restitución cero y la fricción disipa el movimiento tangencial. Las dos granulometrías y humedades modifican la resistencia y la cohesión efectivas del conjunto. Esos coeficientes son supuestos.

La vista 3D representa el carbón fino con granos de hasta 3 o 6 mm según el caso. Su distribución dentro del intervalo es ilustrativa.

El balance muestra la masa vertida, en tránsito, descargada y derramada. La masa en tránsito incluye la parte del pulso que vuela hacia la boca. La descarga se contabiliza al cruzar el plano de salida del CAD. Se usa un paso de 1/120 s y se genera un cuadro cada 0,05 s. Los tiempos y cantidades sirven para visualizar el movimiento. Estimar caudal o atascos exige ensayos y calibración con el material real.

Los CSV históricos en `assets/data` corresponden a la simulación de muestra dispersa anterior a la corrección del frente y de los laterales.

## Ejecución

Sitio estático sin compilación. Se sirve la raíz del repositorio mediante GitHub Pages o un servidor HTTP local. Three.js está incluido en vendor con su licencia.
