"use client";
import { useId } from "react";

interface SparklineProps {
  points: number[];
  color?: string;
  width?: number;
  height?: number;
  fill?: boolean;
}

export default function Sparkline({ points, color = "#a78bfa", width = 96, height = 28, fill = true }: SparklineProps) {
  const uid = useId().replace(/:/g, "");
  if (!points || points.length < 2) {
    return <svg width={width} height={height} aria-hidden />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(0.0001, max - min);
  const stepX = width / (points.length - 1);
  const coords = points.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = fill ? `${line} L${width},${height} L0,${height} Z` : null;
  const id = `spark-${uid}`;
  return (
    <svg width={width} height={height} aria-hidden style={{ overflow: "visible" }}>
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area ?? ""} fill={`url(#${id})`} stroke="none" />
        </>
      )}
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {(() => {
        const [lx, ly] = coords[coords.length - 1];
        return <circle cx={lx} cy={ly} r={2.5} fill={color} />;
      })()}
    </svg>
  );
}
