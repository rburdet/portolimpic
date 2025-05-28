import { useState, useRef, useEffect, useMemo } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush, ReferenceLine, ReferenceArea } from 'recharts';
import { WindDataPoint, formatDate, formatTime, degToCompass16 } from '@/lib/wind-utils';
import { WindArrow } from './WindArrow';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RotateCcw } from 'lucide-react';

interface WindChartProps {
  data: WindDataPoint[];
  title?: string;
  height?: number;
}

interface ChartDataPoint extends WindDataPoint {
  formattedTime: string;
  formattedDate: string;
  windDirection16: string;
  index: number;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload as ChartDataPoint;
    return (
      <div className="bg-white p-3 border border-gray-300 rounded-lg shadow-lg max-w-xs">
        <p className="font-semibold text-sm mb-2">{formatDate(data.datetime)}</p>
        <div className="space-y-1">
          <p className="text-blue-600 text-sm">
            Wind: <span className="font-semibold">{data.wind_speed_knots.toFixed(1)} kn</span>
          </p>
          <p className="text-red-600 text-sm">
            Gust: <span className="font-semibold">{data.max_wind_knots.toFixed(1)} kn</span>
          </p>
          <div className="flex items-center gap-2 text-gray-600 text-sm">
            <span>Direction:</span>
            <WindArrow direction={data.wind_direction} size={14} className="text-gray-700" />
            <span className="font-semibold">{data.windDirection16} ({data.wind_direction.toFixed(0)}°)</span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

export function WindChart({ data, title = "Wind Speed and Direction", height = 400 }: WindChartProps) {
  // Sort data from oldest to newest for proper X-axis display
  const sortedData = [...data].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
  
  // Transform data for the chart
  const chartData: ChartDataPoint[] = sortedData.map((point, index) => ({
    ...point,
    formattedTime: formatTime(point.datetime),
    formattedDate: formatDate(point.datetime),
    windDirection16: degToCompass16(point.wind_direction),
    index,
  }));

  // State management similar to the demo
  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [endTime, setEndTime] = useState<string | null>(null);
  const [originalData] = useState<ChartDataPoint[]>(chartData);
  const [isSelecting, setIsSelecting] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  // Initialize time range
  useEffect(() => {
    if (chartData.length > 0) {
      setStartTime(chartData[0]?.datetime || null);
      setEndTime(chartData[chartData.length - 1]?.datetime || null);
    }
  }, [chartData.length]);

  // Get filtered data based on current zoom - using useMemo for performance
  const zoomedData = useMemo(() => {
    if (!startTime || !endTime) {
      return chartData;
    }

    const dataPointsInRange = originalData.filter(
      (dataPoint) => dataPoint.datetime >= startTime && dataPoint.datetime <= endTime
    );

    // Ensure we have at least two data points for the chart to prevent rendering a single dot
    return dataPointsInRange.length > 1 ? dataPointsInRange : originalData.slice(0, 2);
  }, [startTime, endTime, originalData]);

  // Calculate total wind events for display
  const total = useMemo(
    () => zoomedData.reduce((acc, curr) => acc + curr.wind_speed_knots, 0),
    [zoomedData]
  );

  // Calculate optimal tick interval based on display data length
  const getTickInterval = () => {
    const dataLength = zoomedData.length;
    if (dataLength <= 24) return 0;
    if (dataLength <= 72) return Math.floor(dataLength / 12);
    if (dataLength <= 168) return Math.floor(dataLength / 8);
    return Math.floor(dataLength / 6);
  };

  // Sample data points for wind direction display
  const getDirectionData = () => {
    const maxDirectionLabels = window.innerWidth < 640 ? 6 : 12;
    const step = Math.max(1, Math.floor(zoomedData.length / maxDirectionLabels));
    return zoomedData.filter((_, index) => index % step === 0);
  };

  const handleMouseDown = (e: any) => {
    if (e?.activeLabel) {
      // Find the corresponding datetime for the activeLabel
      const dataPoint = chartData.find(d => d.formattedTime === e.activeLabel);
      if (dataPoint) {
        setRefAreaLeft(dataPoint.datetime);
        setIsSelecting(true);
      }
    }
  };

  const handleMouseMove = (e: any) => {
    if (isSelecting && e?.activeLabel) {
      const dataPoint = chartData.find(d => d.formattedTime === e.activeLabel);
      if (dataPoint) {
        setRefAreaRight(dataPoint.datetime);
      }
    }
  };

  const handleMouseUp = () => {
    if (refAreaLeft && refAreaRight) {
      const [left, right] = [refAreaLeft, refAreaRight].sort();
      if (left && right) {
        setStartTime(left);
        setEndTime(right);
      }
    }
    setRefAreaLeft(null);
    setRefAreaRight(null);
    setIsSelecting(false);
  };

  const handleZoom = (e: React.WheelEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!originalData.length || !chartRef.current) return;

    const firstData = originalData[0];
    const lastData = originalData[originalData.length - 1];
    
    if (!firstData || !lastData) return;

    let zoomFactor = 0.1;
    let direction = 0;
    let clientX = 0;

    if ('deltaY' in e) {
      // Mouse wheel event
      direction = e.deltaY < 0 ? 1 : -1;
      clientX = e.clientX;
    } else if (e.touches && e.touches.length === 2) {
      // Pinch zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      
      if (touch1 && touch2) {
        const currentDistance = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
        
        if ((e as any).lastTouchDistance) {
          direction = currentDistance > (e as any).lastTouchDistance ? 1 : -1;
        }
        (e as any).lastTouchDistance = currentDistance;
        clientX = (touch1.clientX + touch2.clientX) / 2;
      }
    } else {
      return;
    }
    
    const currentRange = new Date(endTime || lastData.datetime).getTime() - 
                        new Date(startTime || firstData.datetime).getTime();
    const zoomAmount = currentRange * zoomFactor * direction;

    const chartRect = chartRef.current.getBoundingClientRect();
    const mouseX = clientX - chartRect.left;
    const chartWidth = chartRect.width;
    const mousePercentage = mouseX / chartWidth;

    const currentStartTime = new Date(startTime || firstData.datetime).getTime();
    const currentEndTime = new Date(endTime || lastData.datetime).getTime();

    const newStartTime = new Date(currentStartTime + zoomAmount * mousePercentage);
    const newEndTime = new Date(currentEndTime - zoomAmount * (1 - mousePercentage));

    // Ensure we don't zoom beyond the original data bounds
    const minTime = new Date(firstData.datetime).getTime();
    const maxTime = new Date(lastData.datetime).getTime();

    if (newStartTime.getTime() >= minTime && newEndTime.getTime() <= maxTime && 
        newEndTime.getTime() > newStartTime.getTime()) {
      setStartTime(newStartTime.toISOString());
      setEndTime(newEndTime.toISOString());
    }
  };

  // Add wheel and touch event listeners
  useEffect(() => {
    const chartElement = chartRef.current;
    if (!chartElement) return;

    const handleWheel = (e: WheelEvent) => handleZoom(e as any);
    const handleTouch = (e: TouchEvent) => handleZoom(e as any);

    chartElement.addEventListener('wheel', handleWheel, { passive: false });
    chartElement.addEventListener('touchmove', handleTouch, { passive: false });

    return () => {
      chartElement.removeEventListener('wheel', handleWheel);
      chartElement.removeEventListener('touchmove', handleTouch);
    };
  }, [originalData, startTime, endTime]);

  const handleReset = () => {
    if (originalData.length > 0) {
      const firstData = originalData[0];
      const lastData = originalData[originalData.length - 1];
      if (firstData && lastData) {
        setStartTime(firstData.datetime);
        setEndTime(lastData.datetime);
      }
    }
    setRefAreaLeft(null);
    setRefAreaRight(null);
  };

  // Calculate average wind speed for reference line
  const avgWindSpeed = zoomedData.length > 0 
    ? zoomedData.reduce((sum, point) => sum + point.wind_speed_knots, 0) / zoomedData.length
    : 0;

  const firstData = originalData[0];
  const lastData = originalData[originalData.length - 1];
  const isZoomed = firstData && lastData && 
    (startTime !== firstData.datetime || endTime !== lastData.datetime);

  const formatXAxis = (tickItem: string) => {
    const dataPoint = chartData.find(d => d.formattedTime === tickItem);
    return dataPoint ? dataPoint.formattedTime : tickItem;
  };

  return (
    <div className="w-full space-y-4">
      {/* Chart Header Card */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{title}</CardTitle>
            <div className="flex items-center gap-2">
              {isZoomed && (
                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                  Showing {zoomedData.length} of {originalData.length} points
                </span>
              )}
              {isZoomed && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="text-xs"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Main Chart Container */}
          <div 
            className="w-full"
            ref={chartRef}
            style={{ touchAction: 'none' }}
          >
            <ResponsiveContainer width="100%" height={height}>
              <ComposedChart 
                data={zoomedData}
                margin={{ 
                  top: 20, 
                  right: 20, 
                  left: 10, 
                  bottom: 60 
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis 
                  dataKey="formattedTime"
                  tick={{ fontSize: 10 }}
                  interval={getTickInterval()}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                  tickFormatter={formatXAxis}
                />
                <YAxis 
                  tick={{ fontSize: 10 }}
                  width={40}
                  label={{ 
                    value: 'Wind Speed (knots)', 
                    angle: -90, 
                    position: 'insideLeft',
                    style: { fontSize: '11px', textAnchor: 'middle' }
                  }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                  wrapperStyle={{ fontSize: '12px' }}
                />
                
                {/* Average wind speed reference line */}
                <ReferenceLine 
                  y={avgWindSpeed} 
                  stroke="#94a3b8" 
                  strokeDasharray="2 2" 
                  label={{ value: `Avg: ${avgWindSpeed.toFixed(1)} kn`, position: "top", fontSize: 10 }}
                />
                
                {/* Wind speed line */}
                <Line
                  type="monotone"
                  dataKey="wind_speed_knots"
                  stroke="#2563eb"
                  strokeWidth={2}
                  name="Wind Speed"
                  dot={false}
                  connectNulls={false}
                />
                
                {/* Max wind (gust) line */}
                <Line 
                  type="monotone" 
                  dataKey="max_wind_knots" 
                  stroke="#dc2626" 
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  name="Gusts"
                  dot={false}
                  connectNulls={false}
                />

                {/* Selection area for zooming */}
                {refAreaLeft && refAreaRight && (
                  <ReferenceArea
                    x1={chartData.find(d => d.datetime === refAreaLeft)?.formattedTime}
                    x2={chartData.find(d => d.datetime === refAreaRight)?.formattedTime}
                    strokeOpacity={0.3}
                    fillOpacity={0.1}
                    fill="#2563eb"
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          
          {/* Instructions */}
          <div className="text-xs text-gray-500 text-center mt-2">
            Click and drag to zoom • Scroll wheel to zoom in/out • Touch gestures supported
          </div>
        </CardContent>
      </Card>
      
      {/* Wind Direction Indicators */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Wind Direction Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-2">
            {getDirectionData().slice(0, 12).map((point, index) => (
              <div key={index} className="flex flex-col items-center p-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <WindArrow 
                  direction={point.wind_direction} 
                  size={18} 
                  className="text-blue-600 mb-1" 
                />
                <span className="text-xs font-medium text-gray-700 text-center">
                  {point.windDirection16}
                </span>
                <span className="text-xs text-gray-500">{point.wind_direction.toFixed(0)}°</span>
                <span className="text-xs text-gray-400 mt-1 text-center">
                  {point.formattedTime}
                </span>
                <span className="text-xs text-blue-600 font-medium">
                  {point.wind_speed_knots.toFixed(1)} kn
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Chart Statistics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-blue-600">
              {Math.max(...zoomedData.map(d => d.wind_speed_knots)).toFixed(1)}
            </div>
            <div className="text-xs text-blue-600">Max Wind (kn)</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-red-600">
              {Math.max(...zoomedData.map(d => d.max_wind_knots)).toFixed(1)}
            </div>
            <div className="text-xs text-red-600">Max Gust (kn)</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-green-600">
              {avgWindSpeed.toFixed(1)}
            </div>
            <div className="text-xs text-green-600">Avg Wind (kn)</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-gray-600">
              {zoomedData.length}
            </div>
            <div className="text-xs text-gray-600">Data Points</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 