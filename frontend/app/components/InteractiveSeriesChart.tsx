"use client";

import {
  Chart,
  ChartCanvas,
  CrossHairCursor,
  EdgeIndicator,
  lastVisibleItemBasedZoomAnchor,
  LineSeries,
  MouseCoordinateX,
  MouseCoordinateY,
  SingleValueTooltip,
  XAxis,
  YAxis,
  ZoomButtons,
  discontinuousTimeScaleProviderBuilder,
} from "react-financial-charts";
import { useEffect, useMemo, useRef, useState } from "react";

type ParserRow = {
  record_index: number;
  started_at_utc: string;
  ended_at_utc: string;
  [key: string]: string | number | null;
};

type SeriesConfig = {
  name: string;
  color: string;
  values: Array<number | null>;
};

type Props = {
  rows: ParserRow[];
  series: SeriesConfig[];
  yAxisLabel: string;
};

export default function InteractiveSeriesChart({ rows, series, yAxisLabel }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(980);
  const [height, setHeight] = useState(420);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const updateWidth = () => {
      const nextWidth = Math.max(320, Math.floor(host.clientWidth || 980));
      setWidth(nextWidth);
      setHeight(nextWidth < 640 ? 320 : 420);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const chartInput = useMemo(
    () =>
      rows.map((row, index) => {
        const item: Record<string, Date | number | undefined> = {
          date: parseDate(row.started_at_utc, index),
          recordIndex: row.record_index,
        };

        series.forEach((entry) => {
          item[entry.name] = entry.values[index] ?? undefined;
        });

        return item;
      }),
    [rows, series],
  );

  const validSeries = series.filter((entry) => entry.values.some((value) => typeof value === "number"));
  const numericValues = validSeries.flatMap((entry) =>
    entry.values.filter((value): value is number => typeof value === "number"),
  );

  if (!rows.length || !validSeries.length || !numericValues.length) {
    return <p style={{ color: "#6f5e42" }}>Selecciona series compatibles para este panel.</p>;
  }

  const minValue = Math.min(...numericValues);
  const maxValue = Math.max(...numericValues);
  const span = maxValue - minValue;
  const padding = span > 0 ? span * 0.08 : Math.max(Math.abs(maxValue) * 0.08, 1);
  const domainMin = minValue - padding;
  const domainMax = maxValue + padding;

  const xScaleProvider = discontinuousTimeScaleProviderBuilder().inputDateAccessor(
    (item: (typeof chartInput)[number]) => item.date as Date,
  );
  const { data, xScale, xAccessor, displayXAccessor } = xScaleProvider(chartInput);
  const xExtents =
    data.length > 1
      ? [xAccessor(data[0]), xAccessor(data[data.length - 1])]
      : [xAccessor(data[0]), xAccessor(data[0])];
  const xAxisTickFormat = (value: Date | number) =>
    formatXAxisTick(resolveXAxisDate(value, data));
  const xAxisDisplayFormat = (value: Date | number) =>
    formatXAxisValue(resolveXAxisDate(value, data));

  return (
    <div ref={hostRef} className="chart-scroll">
      <div className="chart-canvas">
        <ChartCanvas
          clamp={false}
          data={data}
          displayXAccessor={displayXAccessor}
          height={height}
          margin={{
            left: width < 640 ? 56 : 76,
            right: width < 640 ? 64 : 96,
            top: 24,
            bottom: width < 640 ? 56 : 48,
          }}
          ratio={typeof window === "undefined" ? 1 : window.devicePixelRatio || 1}
          seriesName="fluke-interactive-panel"
          useCrossHairStyleCursor
          width={width}
          xAccessor={xAccessor}
          xExtents={xExtents}
          xScale={xScale}
          zoomAnchor={lastVisibleItemBasedZoomAnchor}
          zoomMultiplier={1.15}
        >
          <Chart
            id={1}
            yExtents={() => [domainMin, domainMax]}
          >
            <XAxis showGridLines tickFormat={xAxisTickFormat} ticks={width < 640 ? 4 : 6} />
            <YAxis showGridLines ticks={6} />
            <MouseCoordinateX displayFormat={xAxisDisplayFormat} />
            <MouseCoordinateY displayFormat={formatYAxisValue} rectWidth={70} />
            {validSeries.map((entry, index) => (
              <LineSeries
                key={entry.name}
                strokeStyle={entry.color}
                strokeWidth={2.8}
                yAccessor={(item) =>
                  typeof item[entry.name] === "number" ? (item[entry.name] as number) : undefined
                }
              />
            ))}
            {validSeries.map((entry, index) => (
              <SingleValueTooltip
                key={`${entry.name}-tooltip`}
                origin={[12, 12 + index * 22]}
                yAccessor={(item) =>
                  typeof item[entry.name] === "number" ? (item[entry.name] as number) : Number.NaN
                }
                yDisplayFormat={formatYAxisValue}
                yInitDisplay="n/a"
                yLabel={entry.name}
                valueFill={entry.color}
              />
            ))}
            {validSeries.map((entry) => (
              <EdgeIndicator
                key={`${entry.name}-edge`}
                displayFormat={formatYAxisValue}
                fill={entry.color}
                itemType="last"
                orient="right"
                rectWidth={72}
                textFill="#fffdfa"
                yAccessor={(item) =>
                  typeof item[entry.name] === "number" ? (item[entry.name] as number) : undefined
                }
              />
            ))}
            <ZoomButtons
              fill="rgba(255,250,241,0.96)"
              stroke="rgba(81,61,31,0.24)"
              textFill="#2d2418"
            />
          </Chart>
          <CrossHairCursor />
        </ChartCanvas>
      </div>
      <div style={{ color: "#6f5e42", fontSize: 12, marginTop: 10 }}>
        Zoom con rueda del mouse, panea arrastrando y usa los botones +/- para acercar o resetear.
        Eje Y: {yAxisLabel}
      </div>
    </div>
  );
}

function parseDate(value: string | number | null, index: number) {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(index * 1000);
}

function formatYAxisValue(value: number) {
  return value.toFixed(2);
}

function formatXAxisValue(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatXAxisTick(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function resolveXAxisDate(
  value: Date | number,
  data: Array<Record<string, Date | number | undefined>>,
) {
  if (value instanceof Date) return value;
  const item = data[Math.max(0, Math.min(data.length - 1, Math.round(value)))];
  return item?.date instanceof Date ? item.date : new Date(value);
}
