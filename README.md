# Tolva de antracita

Visor interactivo de las geometrías de 900, 300 y 200 mm, exportadas de las piezas nativas de SOLIDWORKS. Los archivos originales están disponibles desde el visor.

## Datos

Las mallas mantienen los cuerpos, las aristas y los colores del CAD, con coordenadas en metros y eje Z vertical. Las trayectorias CSV contienen coordenadas en milímetros y tiempos en segundos. El navegador interpola las posiciones calculadas y oculta cada grano cuando cruza la descarga.

Se incluyen 24 combinaciones de geometría, granulometría de 0–3 y 0–6 mm, humedad de 5 y 9 % y densidad de grano de 1600 y 1800 kg/m³. Cada caso representa una muestra dispersa de 240 granos, con fricción y cohesión supuestas. La humedad requiere calibración con el carbón del proyecto. Los resultados describen esa muestra y su ventana de 3 segundos. La predicción de caudal, atascos y remanentes de un cucharón completo requiere representar la carga masiva y medir los contactos del material.

La representación utiliza el motor WebGL del navegador. Los marcadores ampliados permiten observar los granos a la escala del conjunto, igual que el visor preparado para SOLIDWORKS. El tamaño físico está conservado en los datos.

## Ejecución

Sitio estático sin compilación. Se sirve la raíz del repositorio mediante GitHub Pages o un servidor HTTP local. Three.js está incluido en vendor con su licencia.
