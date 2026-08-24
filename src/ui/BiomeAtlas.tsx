import { useMemo } from "react";

import { BIOME_DEFINITIONS } from "../config/game.js";
import { createBiomeField } from "../generation/biome-field.js";
import type { DailyMap } from "../generation/types.js";
import {
  biomeBoundaries,
  biomeLabelAnchors,
  biomeRegions,
  sampleBiomeField,
} from "../render/biome-contours.js";
import { sketchPolyline } from "../render/sketch.js";

interface BiomeAtlasProps {
  map: DailyMap;
  cell: number;
  /** Células amostradas além do recorte, para a fronteira continuar do lado de fora. */
  bleed: number;
}

const SAMPLE_STEP = 1;

/**
 * O fundo do mapa: o campo de biomas do dia, desenhado.
 *
 * A lavagem de cor sai de retângulos borrados, não de polígonos: reconstruir
 * região com furo a partir da grade dual é caro e frágil, e a aguada borrada
 * é justamente o aspecto de carta pintada à mão. Quem carrega a precisão é a
 * fronteira, que vem das polilinhas suavizadas e ganha traço trêmulo.
 */
export function BiomeAtlas({ map, cell, bleed }: BiomeAtlasProps) {
  const atlas = useMemo(() => {
    const field = createBiomeField(map.biomeField, map.biomeSites);
    const sample = sampleBiomeField(
      field,
      {
        minX: map.bounds.minX - bleed,
        minY: map.bounds.minY - bleed,
        maxX: map.bounds.maxX + bleed,
        maxY: map.bounds.maxY + bleed,
      },
      SAMPLE_STEP,
    );
    return {
      step: sample.step,
      regions: biomeRegions(sample),
      boundaries: biomeBoundaries(sample),
      anchors: biomeLabelAnchors(sample),
    };
  }, [bleed, map]);

  // A amostra marca o canto da célula; o traço e o rótulo querem o centro dela.
  const center = (value: number) => value * cell + cell / 2;

  return (
    <g className="biome-atlas" aria-hidden="true">
      <g className="biome-wash" filter="url(#biome-wash-blur)">
        {atlas.regions.map((region) => (
          <g key={`wash-${region.biome}`} fill={BIOME_DEFINITIONS[region.biome].color}>
            {region.runs.map((run) => (
              <rect
                key={`${run.x},${run.y}`}
                x={run.x * cell}
                y={run.y * cell}
                width={run.width * cell}
                height={atlas.step * cell}
              />
            ))}
          </g>
        ))}
      </g>

      <g className="biome-texture">
        {atlas.regions.map((region) => (
          <g key={`texture-${region.biome}`} fill={`url(#biome-hatch-${region.biome})`}>
            {region.runs.map((run) => (
              <rect
                key={`${run.x},${run.y}`}
                x={run.x * cell}
                y={run.y * cell}
                width={run.width * cell}
                height={atlas.step * cell}
              />
            ))}
          </g>
        ))}
      </g>

      <g className="biome-coast">
        {atlas.boundaries.map((line, index) => {
          const points = line.map((point) => ({ x: center(point.x), y: center(point.y) }));
          const seed = `${map.id}:fronteira:${index}`;
          return (
            <g key={seed}>
              <path
                className="coast-halo"
                d={sketchPolyline(points, `${seed}:halo`, { roughness: 2.6, passes: 1, step: 26 })}
              />
              <path
                className="coast-line"
                d={sketchPolyline(points, seed, { roughness: 1.4, step: 20 })}
              />
            </g>
          );
        })}
      </g>

      <g className="biome-labels">
        {atlas.anchors
          // Só rotula dentro do recorte: âncora na margem de sangramento sai
          // cortada pela borda do papel e parece defeito, não continuidade.
          .filter(
            (anchor) =>
              anchor.room >= 4 &&
              anchor.x >= map.bounds.minX + 2 &&
              anchor.x <= map.bounds.maxX - 2 &&
              anchor.y >= map.bounds.minY + 1 &&
              anchor.y <= map.bounds.maxY - 1,
          )
          .map((anchor) => (
            <text
              key={`rotulo-${anchor.biome}`}
              x={center(anchor.x)}
              y={center(anchor.y)}
              transform={`rotate(-2 ${center(anchor.x)} ${center(anchor.y)})`}
            >
              {BIOME_DEFINITIONS[anchor.biome].label}
            </text>
          ))}
      </g>
    </g>
  );
}
