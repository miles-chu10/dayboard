import type { ChartPoint } from "./dashboard-data";

export function AreaChart({ data }: { data: ChartPoint[] }) {
  const w = 600;
  const h = 200;
  const padTop = 16;
  const padBottom = 28;
  const padLeft = 8;
  const padRight = 8;
  const chartW = w - padLeft - padRight;
  const chartH = h - padTop - padBottom;

  const values = data.map((d) => d.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const stepX = chartW / Math.max(data.length - 1, 1);

  const points = data.map((d, i) => {
    const x = padLeft + i * stepX;
    const y = padTop + chartH - ((d.value - min) / range) * chartH;
    return { x, y, ...d };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  const areaPath =
    `${linePath} L${points[points.length - 1].x.toFixed(1)},${(padTop + chartH).toFixed(1)}` +
    ` L${padLeft.toFixed(1)},${(padTop + chartH).toFixed(1)} Z`;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => padTop + chartH * t);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--color-accent-500))" stopOpacity="0.25" />
            <stop offset="100%" stopColor="rgb(var(--color-accent-500))" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridLines.map((y, i) => (
          <line
            key={i}
            x1={padLeft}
            y1={y}
            x2={w - padRight}
            y2={y}
            stroke="rgb(var(--color-separator))"
            strokeWidth="0.5"
            strokeDasharray="2 3"
          />
        ))}

        <path d={areaPath} fill="url(#area-fill)" />
        <path
          d={linePath}
          fill="none"
          stroke="rgb(var(--color-accent-500))"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="2.5"
            fill="rgb(var(--color-accent-500))"
            className="transition-opacity"
          />
        ))}

        {points.map((p, i) => {
          if (data.length > 12 && i % Math.ceil(data.length / 8) !== 0) return null;
          return (
            <text
              key={`label-${i}`}
              x={p.x}
              y={h - 8}
              textAnchor="middle"
              className="fill-tertiary"
              style={{ fontSize: "9px" }}
            >
              {p.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
