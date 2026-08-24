import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { sketchRect } from "../render/sketch.js";

interface SketchFrameProps {
  seed: string;
  className?: string;
  roughness?: number;
}

interface Size {
  width: number;
  height: number;
}

const UNMEASURED: Size = { width: 0, height: 0 };

/**
 * Contorno tremido atrás de um elemento HTML. Um SVG inline sai mais nítido e
 * mais barato que filtro de deslocamento sobre `border`.
 *
 * O SVG mede a si mesmo, não o pai: a CSS (`.sketch-frame`) o estica sobre a
 * caixa inteira do painel, enquanto o pai ainda tem padding — e os painéis
 * daqui têm bastante. Medir o pai daria a caixa de conteúdo, e a moldura sairia
 * encolhida pelo padding e encostada no canto superior esquerdo. Medindo o
 * próprio SVG, a caixa medida é exatamente o sistema de coordenadas do path.
 */
export function SketchFrame({ seed, className = "", roughness = 1.6 }: SketchFrameProps) {
  const host = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<Size>(UNMEASURED);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;

    // Arredondar alinha a medida de layout com a do observer: sem isso o
    // subpixel de uma re-render sozinho já dispara outra passada de desenho.
    const measure = (width: number, height: number) => {
      const next = { width: Math.round(width), height: Math.round(height) };
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    };

    // Medida síncrona antes da pintura: a moldura entra já no primeiro quadro,
    // em vez de o painel piscar sem contorno até o observer acordar.
    measure(element.clientWidth, element.clientHeight);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const inset = roughness + 1;
  const outline = useMemo(() => {
    if (size.width <= 0 || size.height <= 0) return "";
    return sketchRect(
      inset,
      inset,
      Math.max(1, size.width - inset * 2),
      Math.max(1, size.height - inset * 2),
      seed,
      { roughness, step: 34 },
    );
  }, [inset, roughness, seed, size.height, size.width]);

  return (
    <svg
      ref={host}
      className={`sketch-frame ${className}`.trim()}
      aria-hidden="true"
      focusable="false"
    >
      {outline ? <path d={outline} /> : null}
    </svg>
  );
}
